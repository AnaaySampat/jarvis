@Command
fun startGestureRecognition(invoke: Invoke) {

    if (
        ContextCompat.checkSelfPermission(
            activity,
            android.Manifest.permission.CAMERA
        ) != PackageManager.PERMISSION_GRANTED
    ) {
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(android.Manifest.permission.CAMERA),
            103
        )

        invoke.resolve(
            result(
                false,
                "Camera permission required. Grant permission and try again."
            )
        )
        return
    }

    if (!Settings.canDrawOverlays(activity)) {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${activity.packageName}")
        )
        activity.startActivity(intent)

        invoke.resolve(
            result(
                false,
                "Allow display over other apps, then try again."
            )
        )
        return
    }

    GestureCameraService.onGesture = { gesture ->

        activity.runOnUiThread {
            speakNow(
                GestureRecognition.response(gesture)
            )
        }
    }

    try {
        val intent = Intent(
            activity,
            GestureCameraService::class.java
        ).apply {
            action = GestureCameraService.ACTION_START
        }

        ContextCompat.startForegroundService(
            activity,
            intent
        )

        invoke.resolve(
            result(true, "Gesture recognition started.")
        )

    } catch (e: Exception) {
        invoke.resolve(
            result(false, "Could not start camera: ${e.message}")
        )
    }
}

@Command
fun stopGestureRecognition(invoke: Invoke) {

    GestureCameraService.onGesture = null

    val intent = Intent(
        activity,
        GestureCameraService::class.java
    ).apply {
        action = GestureCameraService.ACTION_STOP
    }

    activity.stopService(intent)

    invoke.resolve(
        result(true, "Gesture recognition stopped.")
    )
}

