import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseKonfiguration, standardWaehrungCode, localeFormat } from "./config.js";

const firebaseApp = initializeApp(firebaseKonfiguration);
const datenbank = getFirestore(firebaseApp);
const funktionen = getFunctions(firebaseApp, "europe-west1");

const produkteSammlung = collection(datenbank, "produkte");

const produktFormular = document.querySelector("#produktFormular");
const adminStatus = document.querySelector("#adminStatus");
const produktListe = document.querySelector("#produktListe");
const formularLeerenButton = document.querySelector("#formularLeerenButton");
const adminTokenEingabe = document.querySelector("#adminTokenEingabe");
const produktIdEingabe = document.querySelector("#produktIdEingabe");
const produktNameEingabe = document.querySelector("#produktNameEingabe");
const produktBeschreibungEingabe = document.querySelector("#produktBeschreibungEingabe");
const produktPreisEingabe = document.querySelector("#produktPreisEingabe");
const produktWaehrungEingabe = document.querySelector("#produktWaehrungEingabe");
const produktKategorieEingabe = document.querySelector("#produktKategorieEingabe");
const produktAktivCheckbox = document.querySelector("#produktAktivCheckbox");
const optionenDefinitionEingabe = document.querySelector("#optionenDefinitionEingabe");
const produktSpeichernButton = document.querySelector("#produktSpeichernButton");

const produktSpeichernCallable = httpsCallable(funktionen, "adminUpsertProdukt");
const produktLoeschenCallable = httpsCallable(funktionen, "adminDeleteProdukt");

const waehrungsFormatierer = new Intl.NumberFormat(localeFormat, {
  style: "currency",
  currency: standardWaehrungCode
});

function zeigeAdminStatus(text, istFehler = false) {
  adminStatus.textContent = text;
  adminStatus.classList.toggle("fehlermeldung", istFehler);
}

function parseOptionenDefinition(text) {
  if (!text.trim()) {
    return null;
  }
  try {
    const json = JSON.parse(text);
    if (!Array.isArray(json.gruppen)) {
      throw new Error("Optionen benötigen ein Array 'gruppen'.");
    }
    return json;
  } catch (fehler) {
    throw new Error(`Ungültige Optionen-Definition: ${fehler.message}`);
  }
}

produktFormular.addEventListener("submit", async (ereignis) => {
  ereignis.preventDefault();
  zeigeAdminStatus("Sende Daten …");

  let optionenDefinition = null;
  try {
    optionenDefinition = parseOptionenDefinition(optionenDefinitionEingabe.value);
  } catch (fehler) {
    zeigeAdminStatus(fehler.message, true);
    return;
  }

  const produktDaten = {
    produktId: produktIdEingabe.value.trim() || null,
    produktName: produktNameEingabe.value.trim(),
    produktBeschreibung: produktBeschreibungEingabe.value.trim() || null,
    produktPreisBrutto: Number.parseFloat(produktPreisEingabe.value),
    waehrungCode: produktWaehrungEingabe.value.trim() || standardWaehrungCode,
    produktKategorie: produktKategorieEingabe.value.trim() || null,
    produktAktiv: produktAktivCheckbox.checked,
    optionenDefinition
  };

  if (Number.isNaN(produktDaten.produktPreisBrutto)) {
    zeigeAdminStatus("Bitte einen gültigen Preis angeben.", true);
    return;
  }

  const adminToken = adminTokenEingabe.value.trim();
  if (!adminToken) {
    zeigeAdminStatus("Admin-Token ist erforderlich.", true);
    return;
  }

  try {
    produktSpeichernButton.disabled = true;
    const antwort = await produktSpeichernCallable({ adminToken, produkt: produktDaten });
    zeigeAdminStatus(antwort.data.nachricht || "Produkt gespeichert.");
    if (!produktDaten.produktId) {
      produktFormular.reset();
      produktAktivCheckbox.checked = true;
      adminTokenEingabe.value = adminToken;
    }
  } catch (fehler) {
    console.error(fehler);
    const meldung = fehler.message?.includes("permission")
      ? "Admin-Token ungültig."
      : fehler.message || "Speichern fehlgeschlagen.";
    zeigeAdminStatus(meldung, true);
  } finally {
    produktSpeichernButton.disabled = false;
  }
});

formularLeerenButton.addEventListener("click", () => {
  produktFormular.reset();
  produktAktivCheckbox.checked = true;
  zeigeAdminStatus("Formular geleert.");
});

function rendereProduktkarte(produktId, produkt) {
  const karte = document.createElement("article");
  karte.className = "bestellkarte";

  const titel = document.createElement("h3");
  titel.textContent = produkt.produktName;
  karte.appendChild(titel);

  const infoListe = document.createElement("ul");
  const preisElement = document.createElement("li");
  preisElement.textContent = `Preis: ${waehrungsFormatierer.format(produkt.produktPreisBrutto || 0)} (${produkt.waehrungCode || standardWaehrungCode})`;
  infoListe.appendChild(preisElement);

  if (produkt.produktKategorie) {
    const kategorieElement = document.createElement("li");
    kategorieElement.textContent = `Kategorie: ${produkt.produktKategorie}`;
    infoListe.appendChild(kategorieElement);
  }

  if (produkt.produktBeschreibung) {
    const beschreibungElement = document.createElement("li");
    beschreibungElement.textContent = produkt.produktBeschreibung;
    infoListe.appendChild(beschreibungElement);
  }

  const statusElement = document.createElement("li");
  statusElement.textContent = produkt.produktAktiv ? "Status: aktiv" : "Status: inaktiv";
  infoListe.appendChild(statusElement);

  if (produkt.optionenDefinition?.gruppen?.length) {
    const optionenElement = document.createElement("li");
    optionenElement.textContent = `Optionengruppen: ${produkt.optionenDefinition.gruppen
      .map((gruppe) => `${gruppe.label} (${gruppe.typ})`)
      .join(", ")}`;
    infoListe.appendChild(optionenElement);
  }

  karte.appendChild(infoListe);

  const aktionenBereich = document.createElement("div");
  aktionenBereich.className = "aktionen";

  const bearbeitenButton = document.createElement("button");
  bearbeitenButton.type = "button";
  bearbeitenButton.textContent = "In Formular laden";
  bearbeitenButton.addEventListener("click", () => {
    produktIdEingabe.value = produktId;
    produktNameEingabe.value = produkt.produktName || "";
    produktBeschreibungEingabe.value = produkt.produktBeschreibung || "";
    produktPreisEingabe.value = produkt.produktPreisBrutto ?? "";
    produktWaehrungEingabe.value = produkt.waehrungCode || "";
    produktKategorieEingabe.value = produkt.produktKategorie || "";
    produktAktivCheckbox.checked = produkt.produktAktiv !== false;
    optionenDefinitionEingabe.value = produkt.optionenDefinition
      ? JSON.stringify(produkt.optionenDefinition, null, 2)
      : "";
    zeigeAdminStatus("Produktdaten in Formular übertragen.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const loeschenButton = document.createElement("button");
  loeschenButton.type = "button";
  loeschenButton.classList.add("sekundaer");
  loeschenButton.textContent = "Löschen";
  loeschenButton.addEventListener("click", async () => {
    if (!confirm(`Produkt "${produkt.produktName}" löschen?`)) {
      return;
    }
    const adminToken = adminTokenEingabe.value.trim();
    if (!adminToken) {
      zeigeAdminStatus("Zum Löschen bitte zuerst Admin-Token eingeben.", true);
      return;
    }
    try {
      loeschenButton.disabled = true;
      const antwort = await produktLoeschenCallable({ adminToken, produktId });
      zeigeAdminStatus(antwort.data.nachricht || "Produkt gelöscht.");
      if (produktIdEingabe.value === produktId) {
        produktIdEingabe.value = "";
      }
    } catch (fehler) {
      console.error(fehler);
      zeigeAdminStatus(fehler.message || "Löschen fehlgeschlagen.", true);
    } finally {
      loeschenButton.disabled = false;
    }
  });

  aktionenBereich.appendChild(bearbeitenButton);
  aktionenBereich.appendChild(loeschenButton);
  karte.appendChild(aktionenBereich);

  return karte;
}

function beobachteProdukte() {
  const produktQuery = query(produkteSammlung, orderBy("produktName", "asc"));
  onSnapshot(produktQuery, (snapshot) => {
    produktListe.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const produkt = docSnap.data();
      produktListe.appendChild(rendereProduktkarte(docSnap.id, produkt));
    });
    if (snapshot.empty) {
      const hinweis = document.createElement("p");
      hinweis.textContent = "Keine Produkte vorhanden.";
      produktListe.appendChild(hinweis);
    }
  });
}

beobachteProdukte();
