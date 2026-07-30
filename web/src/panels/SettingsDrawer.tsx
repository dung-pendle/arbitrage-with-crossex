import { useCredentials, useVersion } from '../api/queries';
import { CredentialsForm } from '../components/CredentialsForm';
import { Drawer } from '../components/Drawer';
import { AddressForm } from './HomeControls';
import { useTrackedAddress } from './trackedAddress';

/** Settings drawer: the tracked Boros address, masked key display, and the
 * replace-credentials form. */
export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useCredentials();
  const { address, setAddress } = useTrackedAddress();
  const version = useVersion(); // same query key as the header pill — deduped

  return (
    <Drawer open={open} title="Settings" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Tracked Boros address
          </h3>
          <p className="mb-2 text-xs leading-relaxed text-ink-400">
            The EVM address holding your Boros legs. The terminal matches them with your Gate perp
            legs to show your locked and realized return, net of all costs.
          </p>
          <div className="card num mb-2 break-all px-4 py-3 text-xs text-ink-200">
            {address ?? 'not tracking any address'}
          </div>
          {/* Remount on change so the input picks up the new address. */}
          <AddressForm
            key={address ?? 'none'}
            full
            initial={address ?? ''}
            submitLabel={address ? 'Update' : 'Track'}
            onTrack={setAddress}
          />
          {address && (
            <button
              type="button"
              className="btn-ghost-xs mt-2"
              onClick={() => setAddress(null)}
            >
              Stop tracking
            </button>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Gate API key
          </h3>
          <div className="card num px-4 py-3 text-sm text-ink-200">
            {data?.configured ? data.keyMasked ?? '(configured)' : 'not configured'}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Replace credentials
          </h3>
          <CredentialsForm submitLabel="Replace credentials" />
        </section>
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            About
          </h3>
          <div className="card num px-4 py-3 text-xs text-ink-200">
            Version {version.data?.current ?? 'unknown'}
            {version.data?.updateAvailable && version.data.latest
              ? ` — v${version.data.latest} available`
              : ''}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
