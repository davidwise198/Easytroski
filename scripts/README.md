# EasyTroski Scripts

## Seed Routes

This script creates the initial EasyTroski routes in Firestore.

### Quick Start

Run this command from the project root:

```bash
node scripts/seed-routes.js
```

Or using npm:

```bash
npm run seed:routes
```

### What It Does

Creates three initial routes in Firestore:

1. **Omanjor → Accra**
   - Stops: Amasaman, Pokuase, Achimota

2. **Omanjor → Lapaz**
   - Stops: Amasaman, Pokuase

3. **Omanjor → Dome**
   - Stops: Amasaman

### Requirements

- Node.js installed
- Internet connection (to access Firestore)
- Firebase configuration (already in the script)

### Safety

- ✅ Safe to run multiple times (checks for existing routes)
- ✅ Won't create duplicates
- ✅ Only creates routes that don't exist

### Viewing Routes

After running the script, view your routes in Firebase Console:

https://console.firebase.google.com/project/easytroski-65c46/firestore/data/routes

### Alternative Methods

#### Method 1: Run the App
The routes are also seeded automatically when you start the app:
```bash
npm start
```

#### Method 2: TypeScript Version
If you prefer TypeScript:
```bash
npx ts-node scripts/seed-routes.ts
```

### Troubleshooting

**Error: "Cannot find module 'firebase/app'"**
- Run: `npm install`

**Error: "Permission denied"**
- Check Firestore security rules allow authenticated writes
- For admin operations, you may need to temporarily adjust rules

**Routes not appearing in app:**
1. Clear app cache
2. Restart the app
3. Check Firebase Console to verify routes exist
