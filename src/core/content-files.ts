/** Apply numbered content revisions in order: v5 before v40, not after it. */
export const compareContentBundleNames = (left: string, right: string) =>
  left.localeCompare(right, 'en', { numeric: true });
