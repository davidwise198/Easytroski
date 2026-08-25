/**
 * Seed Initial EasyTroski Routes
 * 
 * Run this script to create the initial routes in Firestore:
 * npx ts-node scripts/seed-routes.ts
 * 
 * Or run from the app:
 * - Start the app with: npm start
 * - Routes will be seeded automatically on first launch
 */

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCMCkiB11bejVAygotP4Bk2osl7KRxl-WU",
  authDomain: "easytroski-65c46.firebaseapp.com",
  projectId: "easytroski-65c46",
  storageBucket: "easytroski-65c46.firebasestorage.app",
  messagingSenderId: "1064591962061",
  appId: "1:1064591962061:web:1f69372d71ee7306e31e84",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const initialRoutes = [
  {
    id: "omanjor-accra",
    origin: "Omanjor",
    destination: "Accra",
    stops: ["Amasaman", "Pokuase", "Achimota"],
    active: true,
  },
  {
    id: "omanjor-lapaz",
    origin: "Omanjor",
    destination: "Lapaz",
    stops: ["Amasaman", "Pokuase"],
    active: true,
  },
  {
    id: "omanjor-dome",
    origin: "Omanjor",
    destination: "Dome",
    stops: ["Amasaman"],
    active: true,
  },
];

async function seedRoutes() {
  console.log("🌱 Starting route seeding...\n");

  let createdCount = 0;
  let skippedCount = 0;

  for (const route of initialRoutes) {
    try {
      // Check if route already exists
      const routeRef = doc(db, "routes", route.id);
      const existingRoute = await getDoc(routeRef);

      if (existingRoute.exists()) {
        console.log(`⏭️  Route "${route.id}" already exists, skipping...`);
        skippedCount++;
        continue;
      }

      // Create the route
      await setDoc(routeRef, {
        origin: route.origin,
        destination: route.destination,
        stops: route.stops,
        active: route.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      console.log(`✅ Created route: ${route.origin} → ${route.destination}`);
      createdCount++;
    } catch (error) {
      console.error(`❌ Failed to create route "${route.id}":`, error);
    }
  }

  console.log("\n📊 Summary:");
  console.log(`   Created: ${createdCount} route(s)`);
  console.log(`   Skipped: ${skippedCount} route(s)`);
  console.log(`   Total:   ${initialRoutes.length} route(s)`);
  
  if (createdCount > 0) {
    console.log("\n✨ Routes successfully seeded to Firestore!");
  } else if (skippedCount === initialRoutes.length) {
    console.log("\n✨ All routes already exist in Firestore!");
  }
}

seedRoutes()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
