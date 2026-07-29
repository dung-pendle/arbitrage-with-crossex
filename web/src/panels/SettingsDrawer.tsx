import { useCredentials } from '../api/queries';
import { CredentialsForm } from '../components/CredentialsForm';
import { Drawer } from '../components/Drawer';

/** Settings drawer: masked key display + replace-credentials form. Nothing else yet. */
export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useCredentials();

  return (
    <Drawer open={open} title="Settings" onClose={onClose}>
      <div className="flex flex-col gap-6">
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
      </div>
    </Drawer>
  );
}
