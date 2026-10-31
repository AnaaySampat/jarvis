# Gesture recognizer model

Google MediaPipe canned Gesture Recognizer, float16, model version **1**.
Bundled for offline recognition; the app does not fetch models at runtime.

- Source: https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task
- Guide/model information: https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer
- SHA-256: `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`
- Upstream model license: Apache License 2.0 (included in GESTURE-MODEL-LICENSE.txt).
- Upstream project: https://github.com/google-ai-edge/mediapipe

Uses Open_Palm, Victory, Thumb_Up and Closed_Fist, with a minimum score of 0.8
and an additional 600 ms hold/release filter. A positive recognition is an input
signal, not identity verification or approval of a consequential action.
