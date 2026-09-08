const GIB_MIB = 1024;
const OPTION_STEP_MIB = GIB_MIB;
const DEFAULT_MAX_MIB = 16 * GIB_MIB;
const ADAPTIVE_MAX_MIB = 32 * GIB_MIB;
const MIN_RESERVE_MIB = 3 * GIB_MIB;
const MAX_RESERVE_MIB = 8 * GIB_MIB;

export function getAdaptiveMemoryLimitMib(memoryTotalMib?: number): number {
  if (!memoryTotalMib || !Number.isFinite(memoryTotalMib)) return DEFAULT_MAX_MIB;

  // Windows may report slightly less than the advertised RAM capacity, so round
  // to the nearest GiB before reserving RAM for Windows and the game client.
  const installedMemoryMib = Math.round(memoryTotalMib / GIB_MIB) * GIB_MIB;
  const reserveMib = Math.min(
    MAX_RESERVE_MIB,
    Math.max(MIN_RESERVE_MIB, Math.floor(installedMemoryMib / 4)),
  );
  const assignableMib = Math.max(OPTION_STEP_MIB, installedMemoryMib - reserveMib);
  const roundedAssignableMib = Math.floor(assignableMib / OPTION_STEP_MIB) * OPTION_STEP_MIB;
  return Math.min(ADAPTIVE_MAX_MIB, roundedAssignableMib);
}

export function getMemoryOptions(
  memoryTotalMib: number | undefined,
  currentMemoryMib: number,
  recommendedMemoryMib?: number,
): number[] {
  const limitMib = getAdaptiveMemoryLimitMib(memoryTotalMib);
  const options = new Set<number>();

  for (let value = OPTION_STEP_MIB; value <= limitMib; value += OPTION_STEP_MIB) {
    options.add(value);
  }

  if (currentMemoryMib > 0) options.add(currentMemoryMib);
  if (recommendedMemoryMib && recommendedMemoryMib > 0) options.add(recommendedMemoryMib);

  return [...options].sort((left, right) => left - right);
}
