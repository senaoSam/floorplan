// Normalise an azimuth (degrees) into the [0, 360) range. Handles negatives.
export const wrapAzimuth = (v) => (((v % 360) + 360) % 360)
