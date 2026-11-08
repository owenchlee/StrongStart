// Stub implementation to avoid missing 'sharp' dependency.
// The original image‑tilt estimation is not required for the current
// functionality (orders UI). If needed later, install `sharp` and
// restore the full implementation.
export async function estimateTilt(input) {
  // Return 0 degrees – meaning "no rotation needed".
  return 0;
}
