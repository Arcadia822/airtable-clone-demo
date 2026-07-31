export function compareRanks(
  left: { rank: string },
  right: { rank: string },
): number {
  if (left.rank < right.rank) return -1
  if (left.rank > right.rank) return 1
  return 0
}
