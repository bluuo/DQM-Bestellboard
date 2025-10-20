import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseKonfiguration, standardWaehrungCode, localeFormat } from "./config.js";

const firebaseApp = initializeApp(firebaseKonfiguration);
const datenbank = getFirestore(firebaseApp);

const produkteSammlung = collection(datenbank, "produkte");
const bestellungenSammlung = collection(datenbank, "bestellungen");

const produktAuswahl = document.querySelector("#produktAuswahl");
const produktBeschreibung = document.querySelector("#produktBeschreibung");
const optionenContainer = document.querySelector("#optionenContainer");
const bestellFormular = document.querySelector("#bestellFormular");
const mengeEingabe = document.querySelector("#mengeEingabe");
const kommentarEingabe = document.querySelector("#kommentarEingabe");
const bestellerNameEingabe = document.querySelector("#bestellerName");
const formularStatus = document.querySelector("#formularStatus");
const formularZuruecksetzenButton = document.querySelector("#formularZuruecksetzenButton");
const bestellungenListe = document.querySelector("#bestellungenListe");
const gesamtSummeAnzeige = document.querySelector("#gesamtSummeAnzeige");

let geraeteId = localStorage.getItem("geraeteId");
if (!geraeteId) {
  const erzeugteId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `geraet-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  geraeteId = erzeugteId;
  localStorage.setItem("geraeteId", geraeteId);
}

let produkteCache = new Map();
let aktuelleBearbeitungsId = null;

const waehrungsFormatierer = new Intl.NumberFormat(localeFormat, {
  style: "currency",
  currency: standardWaehrungCode
});

function zeigeStatus(text, istFehler = false) {
  formularStatus.textContent = text;
  formularStatus.classList.toggle("fehlermeldung", istFehler);
}

function berechnePreisSnap({ produkt, ausgewaehlteOptionen, menge }) {
  const basisPreis = produkt.produktPreisBrutto ?? 0;
  const optionenPreis = ausgewaehlteOptionen.reduce((summe, option) => summe + (option.preisDelta ?? 0), 0);
  const einzelpreis = basisPreis + optionenPreis;
  const gesamtpreis = einzelpreis * menge;
  return {
    einzelpreis,
    gesamtpreis,
    waehrung: produkt.waehrungCode || standardWaehrungCode
  };
}

function formatierePreis(betrag, waehrung) {
  try {
    return new Intl.NumberFormat(localeFormat, { style: "currency", currency: waehrung }).format(betrag);
  } catch (fehler) {
    console.warn("Fehler beim Formatieren des Betrags", fehler);
    return waehrungsFormatierer.format(betrag);
  }
}

function optionenFuerProdukt(produkt) {
  optionenContainer.innerHTML = "";
  if (!produkt?.optionenDefinition?.gruppen?.length) {
    return;
  }

  produkt.optionenDefinition.gruppen.forEach((gruppe) => {
    const gruppenElement = document.createElement("div");
    gruppenElement.className = "optionengruppe";

    const titel = document.createElement("h3");
    titel.textContent = `${gruppe.label} (${gruppe.typ === "multi" ? "Mehrfachauswahl" : "Einzelauswahl"})`;
    gruppenElement.appendChild(titel);

    (gruppe.werte || []).forEach((wert, index) => {
      const eingabeId = `${gruppe.id}-${index}`;
      const labelElement = document.createElement("label");
      const eingabeElement = document.createElement("input");
      const delta = wert.preisDelta ?? 0;

      if (gruppe.typ === "multi") {
        eingabeElement.type = "checkbox";
        eingabeElement.name = gruppe.id;
      } else {
        eingabeElement.type = "radio";
        eingabeElement.name = gruppe.id;
      }

      eingabeElement.value = wert.label;
      eingabeElement.dataset.preisDelta = delta;
      eingabeElement.id = eingabeId;

      const textSpan = document.createElement("span");
      textSpan.textContent = wert.label;

      const preisSpan = document.createElement("small");
      preisSpan.textContent = delta !== 0 ? formatierePreis(delta, produkt.waehrungCode || standardWaehrungCode) : "inklusive";

      labelElement.appendChild(eingabeElement);
      labelElement.appendChild(textSpan);
      labelElement.appendChild(preisSpan);
      gruppenElement.appendChild(labelElement);
    });

    optionenContainer.appendChild(gruppenElement);
  });
}

function befuellenFormular(bestellung) {
  aktuelleBearbeitungsId = bestellung.id;
  bestellerNameEingabe.value = bestellung.bestellerName;
  produktAuswahl.value = bestellung.produktId;
  produktAuswahl.dispatchEvent(new Event("change"));
  mengeEingabe.value = bestellung.menge;
  kommentarEingabe.value = bestellung.kommentar || "";

  const produkt = produkteCache.get(bestellung.produktId);
  if (produkt?.optionenDefinition?.gruppen) {
    setTimeout(() => {
      const optionenAuswahl = bestellung.optionenAuswahl || [];
      optionenAuswahl.forEach((option) => {
        const eingaben = optionenContainer.querySelectorAll(`[name="${option.gruppeId}"]`);
        eingaben.forEach((eingabe) => {
          if (eingabe.type === "radio") {
            eingabe.checked = eingabe.value === option.wert;
          } else if (eingabe.type === "checkbox") {
            const werteListe = Array.isArray(option.wert) ? option.wert : [option.wert];
            if (werteListe.includes(eingabe.value)) {
              eingabe.checked = true;
            }
          }
        });
      });
    }, 0);
  }

  bestellFormular.scrollIntoView({ behavior: "smooth" });
  zeigeStatus("Bestellung kann jetzt bearbeitet werden.");
  bestellFormular.dataset.modus = "bearbeiten";
  bestellFormular.querySelector("#bestellSpeichernButton").textContent = "Bestellung aktualisieren";
}

function resetFormular() {
  aktuelleBearbeitungsId = null;
  bestellFormular.reset();
  optionenContainer.innerHTML = "";
  zeigeStatus("");
  delete bestellFormular.dataset.modus;
  bestellFormular.querySelector("#bestellSpeichernButton").textContent = "Bestellung speichern";
}

produktAuswahl.addEventListener("change", (ereignis) => {
  const produktId = ereignis.target.value;
  if (!produktId) {
    produktBeschreibung.textContent = "";
    optionenContainer.innerHTML = "";
    return;
  }

  const produkt = produkteCache.get(produktId);
  if (!produkt) {
    return;
  }
  produktBeschreibung.textContent = produkt.produktBeschreibung || "";
  optionenFuerProdukt(produkt);
});

formularZuruecksetzenButton.addEventListener("click", () => {
  resetFormular();
});

async function speichereBestellung(event) {
  event.preventDefault();
  if (!produktAuswahl.value) {
    zeigeStatus("Bitte ein Produkt auswählen.", true);
    return;
  }

  const produkt = produkteCache.get(produktAuswahl.value);
  if (!produkt) {
    zeigeStatus("Produktdaten konnten nicht geladen werden.", true);
    return;
  }

  const ausgewaehlteOptionen = [];
  const optionenDetail = [];
  const gruppen = produkt.optionenDefinition?.gruppen || [];
  gruppen.forEach((gruppe) => {
    const eingaben = optionenContainer.querySelectorAll(`[name="${gruppe.id}"]`);
    if (gruppe.typ === "single") {
      const ausgewaehlt = Array.from(eingaben).find((eingabe) => eingabe.checked);
      if (ausgewaehlt) {
        const preisDelta = Number.parseFloat(ausgewaehlt.dataset.preisDelta || "0");
        ausgewaehlteOptionen.push({ gruppeId: gruppe.id, wert: ausgewaehlt.value });
        optionenDetail.push({
          gruppeId: gruppe.id,
          gruppenLabel: gruppe.label,
          typ: gruppe.typ,
          wert: ausgewaehlt.value,
          preisDelta: Number(preisDelta.toFixed(2))
        });
      }
    } else {
      const gewaehlteWerte = [];
      let deltaSumme = 0;
      Array.from(eingaben).forEach((eingabe) => {
        if (eingabe.checked) {
          const preisDelta = Number.parseFloat(eingabe.dataset.preisDelta || "0");
          gewaehlteWerte.push(eingabe.value);
          deltaSumme += preisDelta;
        }
      });
      if (gewaehlteWerte.length) {
        ausgewaehlteOptionen.push({ gruppeId: gruppe.id, wert: gewaehlteWerte });
        optionenDetail.push({
          gruppeId: gruppe.id,
          gruppenLabel: gruppe.label,
          typ: gruppe.typ,
          wert: gewaehlteWerte,
          preisDelta: Number(deltaSumme.toFixed(2))
        });
      }
    }
  });

  const menge = Number.parseInt(mengeEingabe.value, 10) || 1;
  const kommentar = kommentarEingabe.value.trim();
  const bestellerName = bestellerNameEingabe.value.trim();

  const preisSnapshot = berechnePreisSnap({
    produkt,
    ausgewaehlteOptionen: optionenDetail,
    menge
  });

  const bestellungPayload = {
    bestellerName,
    produktId: produktAuswahl.value,
    produktNameSnapshot: produkt.produktName,
    produktPreisBruttoSnapshot: produkt.produktPreisBrutto,
    produktWaehrungSnapshot: produkt.waehrungCode || standardWaehrungCode,
    produktOptionenSnapshot: optionenDetail,
    optionenAuswahl: ausgewaehlteOptionen,
    menge,
    kommentar: kommentar || null,
    geraeteId,
    einzelpreisBerechnet: Number(preisSnapshot.einzelpreis.toFixed(2)),
    gesamtpreisBerechnet: Number(preisSnapshot.gesamtpreis.toFixed(2)),
    aktualisiertAm: serverTimestamp()
  };

  try {
    bestellFormular.querySelector("#bestellSpeichernButton").disabled = true;
    if (aktuelleBearbeitungsId) {
      const bestellungRef = doc(bestellungenSammlung, aktuelleBearbeitungsId);
      await updateDoc(bestellungRef, bestellungPayload);
      zeigeStatus("Bestellung aktualisiert.");
    } else {
      await addDoc(bestellungenSammlung, {
        ...bestellungPayload,
        archiviert: false,
        erstelltAm: serverTimestamp()
      });
      zeigeStatus("Bestellung gespeichert.");
    }
    resetFormular();
  } catch (fehler) {
    console.error(fehler);
    zeigeStatus("Speichern fehlgeschlagen. Bitte erneut versuchen.", true);
  } finally {
    bestellFormular.querySelector("#bestellSpeichernButton").disabled = false;
  }
}

bestellFormular.addEventListener("submit", speichereBestellung);

function rendereBestellung(bestellung) {
  const karte = document.createElement("article");
  karte.className = "bestellkarte";
  const titel = document.createElement("h3");
  titel.textContent = `${bestellung.bestellerName} – ${bestellung.produktNameSnapshot}`;
  karte.appendChild(titel);

  const infoListe = document.createElement("ul");
  const mengeElement = document.createElement("li");
  mengeElement.textContent = `Menge: ${bestellung.menge}`;
  infoListe.appendChild(mengeElement);

  if (bestellung.produktOptionenSnapshot?.length) {
    const optionenElement = document.createElement("li");
    const optionenDetails = bestellung.produktOptionenSnapshot
      .map((option) => {
        const deltaText = option.preisDelta
          ? ` (${formatierePreis(option.preisDelta, bestellung.produktWaehrungSnapshot)})`
          : "";
        return `${option.gruppenLabel}: ${Array.isArray(option.wert) ? option.wert.join(", ") : option.wert}${deltaText}`;
      })
      .join(" · ");
    optionenElement.textContent = `Optionen: ${optionenDetails}`;
    infoListe.appendChild(optionenElement);
  }

  if (bestellung.kommentar) {
    const kommentarElement = document.createElement("li");
    kommentarElement.textContent = `Kommentar: ${bestellung.kommentar}`;
    infoListe.appendChild(kommentarElement);
  }

  const einzelpreisElement = document.createElement("li");
  einzelpreisElement.textContent = `Einzelpreis: ${formatierePreis(
    bestellung.einzelpreisBerechnet,
    bestellung.produktWaehrungSnapshot
  )}`;
  infoListe.appendChild(einzelpreisElement);

  const gesamtpreisElement = document.createElement("li");
  gesamtpreisElement.innerHTML = `Gesamt: <strong>${formatierePreis(
    bestellung.gesamtpreisBerechnet,
    bestellung.produktWaehrungSnapshot
  )}</strong>`;
  infoListe.appendChild(gesamtpreisElement);

  karte.appendChild(infoListe);

  if (bestellung.geraeteId === geraeteId) {
    const aktionenBereich = document.createElement("div");
    aktionenBereich.className = "aktionen";

    const bearbeitenButton = document.createElement("button");
    bearbeitenButton.type = "button";
    bearbeitenButton.textContent = "Bearbeiten";
    bearbeitenButton.addEventListener("click", () => befuellenFormular(bestellung));

    const loeschenButton = document.createElement("button");
    loeschenButton.type = "button";
    loeschenButton.classList.add("sekundaer");
    loeschenButton.textContent = "Löschen";
    loeschenButton.addEventListener("click", async () => {
      if (!confirm("Bestellung wirklich löschen?")) {
        return;
      }
      try {
        await updateDoc(doc(bestellungenSammlung, bestellung.id), {
          archiviert: true,
          archiviertAm: serverTimestamp(),
          aktualisiertAm: serverTimestamp()
        });
        zeigeStatus("Bestellung gelöscht.");
        if (aktuelleBearbeitungsId === bestellung.id) {
          resetFormular();
        }
      } catch (fehler) {
        console.error(fehler);
        zeigeStatus("Löschen fehlgeschlagen.", true);
      }
    });

    aktionenBereich.appendChild(bearbeitenButton);
    aktionenBereich.appendChild(loeschenButton);
    karte.appendChild(aktionenBereich);

    const eigeneBestellungBadge = document.createElement("span");
    eigeneBestellungBadge.className = "badge";
    eigeneBestellungBadge.textContent = "Eigene Bestellung";
    karte.appendChild(eigeneBestellungBadge);
  }

  return karte;
}

function beobachteBestellungen() {
  const bestellQuery = query(bestellungenSammlung, orderBy("erstelltAm", "desc"));
  onSnapshot(bestellQuery, (snapshot) => {
    bestellungenListe.innerHTML = "";
    let gesamtsumme = 0;
    let aktiveBestellungen = 0;
    snapshot.forEach((docSnap) => {
      const daten = docSnap.data();
      if (daten.archiviert) {
        return;
      }
      aktiveBestellungen += 1;
      const bestellung = { id: docSnap.id, ...daten };
      gesamtsumme += bestellung.gesamtpreisBerechnet || 0;
      bestellungenListe.appendChild(rendereBestellung(bestellung));
    });

    if (!aktiveBestellungen) {
      const leerHinweis = document.createElement("p");
      leerHinweis.textContent = "Noch keine Bestellungen vorhanden.";
      bestellungenListe.appendChild(leerHinweis);
    }

    gesamtSummeAnzeige.textContent = aktiveBestellungen
      ? formatierePreis(gesamtsumme, standardWaehrungCode)
      : "–";
  });
}

function beobachteProdukte() {
  const produktQuery = query(produkteSammlung, orderBy("produktName", "asc"));
  onSnapshot(produktQuery, (snapshot) => {
    produkteCache = new Map();
    produktAuswahl.innerHTML = '<option value="">Bitte wählen …</option>';
    snapshot.forEach((docSnap) => {
      const produkt = docSnap.data();
      if (produkt.produktAktiv === false) {
        return;
      }
      produkteCache.set(docSnap.id, { id: docSnap.id, ...produkt });
      const optionElement = document.createElement("option");
      optionElement.value = docSnap.id;
      optionElement.textContent = produkt.produktName;
      produktAuswahl.appendChild(optionElement);
    });

    if (snapshot.empty) {
      produktBeschreibung.textContent = "Keine aktiven Produkte verfügbar.";
    } else if (!produktAuswahl.value) {
      produktBeschreibung.textContent = "";
    }
  });
}

beobachteProdukte();
beobachteBestellungen();
