import type { GetBlockTimingReturnType } from '@arkiv-network/sdk';

const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
// This sample consumes arkiv-chunking 0.1.0, whose admission limits are block based.
const MAX_EXPIRATION_BLOCKS = 15_768_000;
const MAX_CHUNKS = 4096;
export const MAX_TIMING_AGE_MS = 5 * 60 * 1000;

/** Safe, user-facing input errors; never contains a provider response or URL. */
export class ExpirationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpirationInputError';
  }
}

function fail(message: string): never { throw new ExpirationInputError(message); }

function validTiming(timing: GetBlockTimingReturnType, nowMs: number): void {
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > MAX_DATE_MS) {
    fail('Your device date is invalid. Check it before choosing an expiration.');
  }
  if (!timing || typeof timing.currentBlock !== 'bigint' || timing.currentBlock < 0n || timing.currentBlock > MAX_UINT64 ||
      !Number.isSafeInteger(timing.currentBlockTime) || timing.currentBlockTime < 0 ||
      !Number.isFinite(timing.blockDuration) || timing.blockDuration <= 0) {
    fail('Network timing is unavailable. Try again before choosing an expiration.');
  }
  // Fail closed when the timing is stale or the device/network clocks differ by over five minutes.
  if (Math.abs(nowMs - timing.currentBlockTime * 1000) > MAX_TIMING_AGE_MS) {
    fail('Network timing and your device clock differ by more than five minutes. Check your clock, or retry once the network resumes producing blocks.');
  }
}

/**
 * Converts a requested local date to the package's relative block budget using fresh network timing.
 * This is an estimate: approval delays and changing block production can move actual expiration.
 * Never clamps a date to a different lifetime. Call immediately before upload, after connecting.
 */
export function dateToBlocks(
  selectedDate: Date,
  timing: GetBlockTimingReturnType,
  chunkCount: number,
  nowMs = Date.now(),
): number {
  validTiming(timing, nowMs);
  if (!(selectedDate instanceof Date) || !Number.isFinite(selectedDate.getTime())) {
    fail('Choose a valid expiration date and time.');
  }
  if (selectedDate.getTime() <= nowMs) fail('Choose an expiration date in the future.');
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) {
    fail('Choose a file with a supported number of chunks.');
  }
  const blocks = Math.ceil((selectedDate.getTime() / 1000 - timing.currentBlockTime) / timing.blockDuration);
  const minimum = Math.max(32, chunkCount + 3);
  if (blocks < minimum) {
    fail('Choose a later expiration so there is time to approve and store this file.');
  }
  if (!Number.isSafeInteger(blocks) || blocks > MAX_EXPIRATION_BLOCKS || timing.currentBlock + BigInt(blocks) > MAX_UINT64) {
    fail('Choose an earlier expiration. This date exceeds the supported storage lifetime.');
  }
  return blocks;
}

/** Estimates the returned entity expiration from fresh timing, including already expired dates. */
export function estimateExpirationDate(
  expiresAt: bigint,
  timing: GetBlockTimingReturnType,
  nowMs = Date.now(),
): Date {
  validTiming(timing, nowMs);
  if (typeof expiresAt !== 'bigint' || expiresAt < 0n || expiresAt > MAX_UINT64) {
    fail('The entity expiration cannot be displayed as a date.');
  }
  const remaining = expiresAt - timing.currentBlock;
  if (remaining > MAX_SAFE_BIGINT || remaining < -MAX_SAFE_BIGINT) {
    fail('The entity expiration is outside the supported date range.');
  }
  const dateMs = (timing.currentBlockTime + Number(remaining) * timing.blockDuration) * 1000;
  if (!Number.isFinite(dateMs) || Math.abs(dateMs) > MAX_DATE_MS) {
    fail('The entity expiration is outside the supported date range.');
  }
  return new Date(dateMs);
}

/** A datetime-local value in the device's timezone; never truncates a UTC ISO string. */
export function toLocalDateTimeInput(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('Choose a valid expiration date and time.');
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
