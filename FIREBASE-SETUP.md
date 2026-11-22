# Firebase setup: do this once after deploying

The app's code is on Netlify, but the **security rules live inside Firebase**. Netlify never sends them there.
If the rules in Firebase are old or missing, you get "Could not load this section", announcements that vanish
after 2 seconds, and uploads that fail. The steps below fix that. They take about 5 minutes on a computer.

## 1. Publish the Firestore rules
1. Open https://console.firebase.google.com and choose the TLDS project.
2. Go to **Build → Firestore Database → Rules**.
3. Delete everything in the editor. Open `firestore.rules` from this project, copy all of it and paste it in.
4. Click **Publish**.

## 2. Turn on Storage and publish its rules (needed for recording uploads)
1. Go to **Build → Storage**.
   - If you see **Get started**, Storage was never set up. Click it and follow the steps.
     Projects created after October 2024 must be on the **Blaze** (pay-as-you-go) plan to use Storage.
     A small church normally stays inside the free allowance (5 GB stored).
2. At the top of the Files tab you'll see the bucket name, like `gs://tldschool.firebasestorage.app`.
   Copy it **without** the `gs://` part.
3. Open the **Rules** tab. Delete everything, paste the contents of `storage.rules`, then click **Publish**.
   If Firebase asks to let Storage read Firestore ("cross-service rules"), click **Allow**.

## 3. Check the bucket name in Netlify
1. Netlify → your site → **Site configuration → Environment variables**.
2. `VITE_FIREBASE_STORAGE_BUCKET` must be **exactly** the bucket name from step 2.2
   (for example `tldschool.firebasestorage.app` or `tldschool.appspot.com`). A wrong name makes uploads hang at 0%.
3. If you changed it, go to **Deploys → Trigger deploy → Clear cache and deploy site**.

## 4. Indexes (optional now)
The app no longer needs any database indexes. `firestore.indexes.json` is only used by the optional
Cloud Functions (phone push). Skip this unless you deploy those functions.

## 5. Check that it worked
- Open the app and refresh. The red "Could not load this section" boxes should be gone.
- Post a test announcement. You should see "Announcement published." and it should stay.
- Press **Upload to library** on the unsaved recording. The percentage should start climbing.
  If something still fails, the red message now says *why* (for example "Permission denied" or
  "The file server is not responding"). Send that message to whoever is helping you.

## If you have the Firebase CLI on a computer
Instead of steps 1, 2.3 and 4: `firebase deploy --only firestore:rules,firestore:indexes,storage`
