const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_123";
const BOB_UID = "bob_456";

const [emulatorHost, emulatorPortStr] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085"
).split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

test("Unauthenticated user: cannot read or write profiles, transactions, or udharEntries", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).get());
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("transactions").get()
  );
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("udharEntries").get()
  );
  await assertFails(
    unauthDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx_1")
      .set({
        userId: ALICE_UID,
        type: "EXPENSE",
        amountPaise: 10000,
        category: "भोजन",
        note: "चाय नाश्ता",
        dateKey: "2026-11-17",
        monthKey: "2026-11",
        source: "MANUAL",
        createdAt: new Date(Date.now() - 1000),
        updatedAt: new Date(Date.now() - 1000),
      })
  );
});

test("Authenticated owner: valid UserProfile create & partial update succeed; cross-user fails", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const now = new Date(Date.now() - 5000);

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).set({
      userId: ALICE_UID,
      displayName: "रमेश कुमार",
      email: "ramesh@example.com",
      openingBalancePaise: 500000,
      monthlyBudgetPaise: 2500000,
      createdAt: now,
      updatedAt: now,
    })
  );

  // Partial update allowed fields
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).update({
      openingBalancePaise: 600000,
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Immutable createdAt cannot be modified
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).update({
      createdAt: new Date(Date.now() - 500),
      updatedAt: new Date(Date.now() - 500),
    })
  );

  // Cross-user read & write rejected
  await assertFails(bobDb.collection("users").doc(ALICE_UID).get());
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).update({
      openingBalancePaise: 0,
      updatedAt: new Date(Date.now() - 1000),
    })
  );
  // Collection-level user listing rejected
  await assertFails(aliceDb.collection("users").get());
});

test("Authenticated owner: LedgerTransaction create, partial update, list, delete & negative guards", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = new Date(Date.now() - 10000);

  // Valid create (no @DocumentId 'id' field in body)
  await assertSucceeds(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-1")
      .set({
        userId: ALICE_UID,
        type: "EXPENSE",
        amountPaise: 10000,
        category: "भोजन",
        note: "दोपहर का खाना",
        dateKey: "2026-11-17",
        monthKey: "2026-11",
        source: "SMART_TEXT",
        createdAt: created,
        updatedAt: created,
      })
  );

  // Subcollection list query succeeds for owner
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("transactions").get()
  );

  // Partial update succeeds
  await assertSucceeds(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-1")
      .update({
        amountPaise: 12000,
        note: "खाना और पानी",
        updatedAt: new Date(Date.now() - 1000),
      })
  );

  // Reject ghost 'id' field on create
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-2")
      .set({
        id: "tx-uuid-2",
        userId: ALICE_UID,
        type: "EXPENSE",
        amountPaise: 5000,
        category: "अन्य",
        note: "Invalid",
        dateKey: "2026-11-17",
        monthKey: "2026-11",
        source: "MANUAL",
        createdAt: created,
        updatedAt: created,
      })
  );

  // Reject zero or negative amount
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-3")
      .set({
        userId: ALICE_UID,
        type: "INCOME",
        amountPaise: 0,
        category: "वेतन",
        note: "Zero",
        dateKey: "2026-11-17",
        monthKey: "2026-11",
        source: "MANUAL",
        createdAt: created,
        updatedAt: created,
      })
  );

  // Reject future tampered timestamp
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-4")
      .set({
        userId: ALICE_UID,
        type: "EXPENSE",
        amountPaise: 5000,
        category: "अन्य",
        note: "Future",
        dateKey: "2026-11-17",
        monthKey: "2026-11",
        source: "MANUAL",
        createdAt: new Date(Date.now() + 120000),
        updatedAt: new Date(Date.now() + 120000),
      })
  );

  // Cross-user access fails
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("transactions").get()
  );
  await assertFails(
    bobDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-1")
      .delete()
  );

  // Owner delete succeeds
  await assertSucceeds(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("transactions")
      .doc("tx-uuid-1")
      .delete()
  );
});

test("Authenticated owner: UdharEntry create (with and without optional fields), update, list & isolation", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = new Date(Date.now() - 8000);

  // Without optional fields
  await assertSucceeds(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("udharEntries")
      .doc("udhar-1")
      .set({
        userId: ALICE_UID,
        personName: "सुरेश",
        personKey: "सुरेश",
        entryType: "GIVEN",
        amountPaise: 50000,
        dateKey: "2026-11-17",
        note: "दवाई के लिए दिए",
        createdAt: created,
        updatedAt: created,
      })
  );

  // With optional fields
  await assertSucceeds(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("udharEntries")
      .doc("udhar-2")
      .set({
        userId: ALICE_UID,
        personName: "महेश",
        personKey: "महेश",
        phone: "9876543210",
        entryType: "BORROWED",
        amountPaise: 100000,
        dateKey: "2026-11-16",
        dueDateKey: "2026-12-01",
        note: "किराने का सामान",
        createdAt: created,
        updatedAt: created,
      })
  );

  // Repayment update
  await assertSucceeds(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("udharEntries")
      .doc("udhar-1")
      .update({
        amountPaise: 60000,
        note: "सुधारित राशि",
        updatedAt: new Date(Date.now() - 1000),
      })
  );

  // Invalid entryType fails
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("udharEntries")
      .doc("udhar-bad")
      .set({
        userId: ALICE_UID,
        personName: "राज",
        personKey: "राज",
        entryType: "INVALID_TYPE",
        amountPaise: 1000,
        dateKey: "2026-11-17",
        note: "",
        createdAt: created,
        updatedAt: created,
      })
  );

  // Bob cannot list or delete Alice's udhar entries
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("udharEntries").get()
  );
  await assertFails(
    bobDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("udharEntries")
      .doc("udhar-1")
      .delete()
  );
});
