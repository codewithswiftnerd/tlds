/** Turns Firebase error codes into plain words for members and admins. */
export function explainError(e) {
  const raw = String(e?.code || '');
  const code = raw.replace(/^(firestore|storage|functions)\//, '');
  const msg = String(e?.message || '');
  switch (code) {
    case 'permission-denied':
    case 'unauthorized':
      return 'Permission denied. An admin needs to publish the latest Firebase rules (see FIREBASE-SETUP.md).';
    case 'unauthenticated':
      return 'You are signed out. Please sign in again.';
    case 'failed-precondition':
      return /index/i.test(msg)
        ? 'A database index is missing. An admin needs to create it in the Firebase console.'
        : 'The database is not ready for this yet.';
    case 'unavailable':
    case 'retry-limit-exceeded':
      return 'Could not reach the server. Check your internet connection.';
    case 'deadline-exceeded':
      return 'The server did not answer in time. Check your connection and try again.';
    case 'no-response':
      return 'The file server is not responding. Firebase Storage may not be set up, or the storage bucket name in Netlify is wrong.';
    case 'bucket-not-found':
    case 'no-default-bucket':
    case 'invalid-default-bucket':
    case 'project-not-found':
      return 'The storage bucket was not found. Check VITE_FIREBASE_STORAGE_BUCKET in Netlify.';
    case 'quota-exceeded':
      return 'The storage space is full.';
    case 'not-found':
      return 'It no longer exists.';
    default:
      return raw ? `Error: ${raw}` : 'Something went wrong.';
  }
}

/** Rejects if `promise` has not settled after `ms` (so buttons never spin forever). */
export function withTimeout(promise, ms = 30000) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' })), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
