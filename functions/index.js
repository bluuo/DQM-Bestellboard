const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const firestore = admin.firestore();
const region = "europe-west1";

function holeAdminTokenKonfiguration() {
  const configToken = functions.config().admin?.token || process.env.ADMIN_TOKEN;
  if (!configToken) {
    functions.logger.error("Admin-Token nicht konfiguriert. Bitte per 'firebase functions:config:set admin.token=...' setzen.");
    throw new functions.https.HttpsError("failed-precondition", "Admin-Token ist nicht konfiguriert.");
  }
  return configToken;
}

function pruefeAdminToken(eingereichtesToken) {
  const erwartetesToken = holeAdminTokenKonfiguration();
  if (!eingereichtesToken || eingereichtesToken !== erwartetesToken) {
    throw new functions.https.HttpsError("permission-denied", "Ungültiges Admin-Token.");
  }
}

function bereinigeOptionenDefinition(optionenDefinitionRoh) {
  if (!optionenDefinitionRoh || typeof optionenDefinitionRoh !== "object") {
    return null;
  }

  const gruppen = Array.isArray(optionenDefinitionRoh.gruppen)
    ? optionenDefinitionRoh.gruppen
    : [];

  const gruppenBereinigt = gruppen
    .map((gruppe) => {
      const id = typeof gruppe.id === "string" ? gruppe.id.trim() : "";
      const label = typeof gruppe.label === "string" ? gruppe.label.trim() : "";
      const typ = gruppe.typ === "multi" ? "multi" : "single";
      const werte = Array.isArray(gruppe.werte) ? gruppe.werte : [];

      const werteBereinigt = werte
        .map((wert) => {
          const wertLabel = typeof wert.label === "string" ? wert.label.trim() : "";
          const preisDelta = Number.parseFloat(wert.preisDelta);
          return {
            label: wertLabel,
            preisDelta: Number.isFinite(preisDelta) ? Number(preisDelta.toFixed(2)) : 0
          };
        })
        .filter((wert) => wert.label);

      if (!id || !label) {
        return null;
      }

      return {
        id,
        label,
        typ,
        werte: werteBereinigt
      };
    })
    .filter(Boolean);

  if (!gruppenBereinigt.length) {
    return null;
  }

  return { gruppen: gruppenBereinigt };
}

function validiereProduktdaten(produkt) {
  if (!produkt || typeof produkt !== "object") {
    throw new functions.https.HttpsError("invalid-argument", "Produktdaten fehlen.");
  }
  const produktName = typeof produkt.produktName === "string" ? produkt.produktName.trim() : "";
  if (!produktName) {
    throw new functions.https.HttpsError("invalid-argument", "Produktname ist erforderlich.");
  }

  const produktPreis = Number.parseFloat(produkt.produktPreisBrutto);
  if (!Number.isFinite(produktPreis) || produktPreis < 0) {
    throw new functions.https.HttpsError("invalid-argument", "Produktpreis muss >= 0 sein.");
  }

  const produktBeschreibung = typeof produkt.produktBeschreibung === "string"
    ? produkt.produktBeschreibung.trim()
    : null;

  const produktKategorie = typeof produkt.produktKategorie === "string"
    ? produkt.produktKategorie.trim()
    : null;

  const produktAktiv = typeof produkt.produktAktiv === "boolean" ? produkt.produktAktiv : true;
  const waehrungCode = typeof produkt.waehrungCode === "string" && produkt.waehrungCode.trim().length
    ? produkt.waehrungCode.trim().toUpperCase()
    : "EUR";

  return {
    produktName,
    produktBeschreibung: produktBeschreibung || null,
    produktPreisBrutto: Number(produktPreis.toFixed(2)),
    produktKategorie: produktKategorie || null,
    produktAktiv,
    waehrungCode,
    optionenDefinition: bereinigeOptionenDefinition(produkt.optionenDefinition),
    aktualisiertAm: admin.firestore.FieldValue.serverTimestamp()
  };
}

exports.adminUpsertProdukt = functions
  .region(region)
  .https.onCall(async (daten) => {
    pruefeAdminToken(daten?.adminToken);

    const produktDaten = validiereProduktdaten(daten?.produkt);
    const produktIdRoh = typeof daten?.produkt?.produktId === "string"
      ? daten.produkt.produktId.trim()
      : null;

    if (produktIdRoh) {
      const produktRef = firestore.collection("produkte").doc(produktIdRoh);
      await produktRef.set(produktDaten, { merge: true });
      return { nachricht: "Produkt aktualisiert.", produktId: produktIdRoh };
    }

    const produktRef = await firestore.collection("produkte").add({
      ...produktDaten,
      erstelltAm: admin.firestore.FieldValue.serverTimestamp()
    });
    return { nachricht: "Produkt erstellt.", produktId: produktRef.id };
  });

exports.adminDeleteProdukt = functions
  .region(region)
  .https.onCall(async (daten) => {
    pruefeAdminToken(daten?.adminToken);
    const produktId = typeof daten?.produktId === "string" ? daten.produktId.trim() : "";
    if (!produktId) {
      throw new functions.https.HttpsError("invalid-argument", "Produkt-ID ist erforderlich.");
    }

    await firestore.collection("produkte").doc(produktId).delete();
    return { nachricht: "Produkt gelöscht.", produktId };
  });
