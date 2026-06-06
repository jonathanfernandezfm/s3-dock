export function isSearchIndexEnabled(): boolean {
  return process.env.SEARCH_INDEX_ENABLED === "true";
}
