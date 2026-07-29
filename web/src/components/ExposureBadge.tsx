import { Chip } from './Chip';

/** Hedge-status chip for an exposure group — the label+tone mapping used in the
 * PerpOnlyBox header. */
export function ExposureBadge({
  group,
}: {
  group: { neutral: boolean; singleLeg: boolean };
}) {
  if (group.neutral) return <Chip sm tone="green">neutral ✓</Chip>;
  if (group.singleLeg) return <Chip sm tone="red">single leg</Chip>;
  return <Chip sm tone="amber">imbalanced</Chip>;
}
