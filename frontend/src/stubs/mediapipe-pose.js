/**
 * Stub module for @mediapipe/pose.
 *
 * @tensorflow-models/pose-detection statically imports @mediapipe/pose
 * for BlazePose support. Since we only use MoveNet, we provide this
 * stub to satisfy the import without bundling the full MediaPipe SDK.
 */

class Pose {
  constructor() {}
  initialize() { return Promise.resolve(); }
  send() { return Promise.resolve(); }
  close() {}
  onResults() {}
  setOptions() {}
  reset() {}
}

module.exports = {
  Pose,
  POSE_CONNECTIONS: [],
  POSE_LANDMARKS: {},
  POSE_LANDMARKS_LEFT: {},
  POSE_LANDMARKS_RIGHT: {},
  POSE_LANDMARKS_NEUTRAL: {},
  VERSION: "0.0.0-stub",
};
