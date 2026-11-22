import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { canPromptInstall, isInstalled, isIos, onInstallChange, promptInstall } from '../../services/install';

/** Offers to install TLDS LIVE on the phone or computer, so it opens like an app (no browser bar). */
export default function InstallApp({ hideHint }) {
  const [, rerender] = useState(0);
  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), []);
  if (isInstalled()) return null;
  if (canPromptInstall()) {
    return (
      <div className="callout">
        <p><Smartphone size={16} /> <strong>Install TLDS LIVE</strong> on this device for one-tap access, like a normal app.</p>
        <button className="btn primary sm" onClick={promptInstall}>Install</button>
      </div>
    );
  }
  if (isIos() && !hideHint) return <p className="muted small"><Smartphone size={14} /> To install on iPhone: tap Share, then &ldquo;Add to Home Screen&rdquo;.</p>;
  return null;
}
