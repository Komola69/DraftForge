package com.draftforge.app

import android.graphics.Bitmap
import android.graphics.Color
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "DraftForgeVision")
class DraftForgeVisionPlugin : Plugin() {

    /**
     * State-change detection: Only fire bridge events when the draft screen
     * has definitively changed (hero locked, ban confirmed, phase shift).
     * This prevents IPC saturation from streaming raw frames at 30fps.
     */
    private var lastHashSnapshot: List<Long> = emptyList()
    private var lastEmitTimestamp: Long = 0
    private val MIN_EMIT_INTERVAL_MS = 500L  // Hard floor: max 2 bridge events/sec
    private val HASH_CHANGE_THRESHOLD = 2    // Min slots that must change to trigger

    // Simulating the MediaProjection Frame arrival
    fun processFrame(bitmap: Bitmap) {
        val hashes = mutableListOf<Long>()
        
        // Example: 10 hardcoded safe-zones for draft slots
        for (i in 0..9) {
            val sx = (bitmap.width * 0.15).toInt()
            val sy = (bitmap.height * 0.05).toInt()
            val sw = (bitmap.width * 0.70).toInt()
            val sh = (bitmap.height * 0.40).toInt()
            
            // Crop
            val cropped = Bitmap.createBitmap(bitmap, sx, sy, sw, sh)
            // Scale to 8x8 for dHash
            val scaled = Bitmap.createScaledBitmap(cropped, 8, 8, true)
            
            val hash = calculateDHash(scaled)
            hashes.add(hash)
        }

        // ============================================================
        // Debounce Gate: Only emit if state has materially changed
        // ============================================================
        val now = System.currentTimeMillis()
        
        // Time gate: don't fire more than 2x/sec regardless of changes
        if (now - lastEmitTimestamp < MIN_EMIT_INTERVAL_MS) return

        // Change detection: count how many slot hashes differ from last snapshot
        val changedSlots = if (lastHashSnapshot.size != hashes.size) {
            hashes.size // First run or slot count changed — always emit
        } else {
            hashes.zip(lastHashSnapshot).count { (a, b) -> a != b }
        }

        // Only emit if enough slots changed (filters out noise/animation frames)
        if (changedSlots < HASH_CHANGE_THRESHOLD) return

        // Commit: update snapshot and fire bridge event
        lastHashSnapshot = hashes.toList()
        lastEmitTimestamp = now

        // Send 100-byte micro-payload over the Capacitor Bridge
        val result = JSObject()
        result.put("hashes", hashes)
        result.put("changedSlots", changedSlots)
        result.put("timestamp", now)
        notifyListeners("onScreenDraftDetected", result)
    }

    private fun calculateDHash(bitmap: Bitmap): Long {
        val pixels = IntArray(64)
        bitmap.getPixels(pixels, 0, 8, 0, 0, 8, 8)
        
        var hash = 0L
        for (i in 0..63) {
            val r = Color.red(pixels[i])
            val g = Color.green(pixels[i])
            val b = Color.blue(pixels[i])
            val currentLuma = (0.299 * r + 0.587 * g + 0.114 * b).toInt()
            
            val nextIdx = if (i == 63) 0 else i + 1
            val nr = Color.red(pixels[nextIdx])
            val ng = Color.green(pixels[nextIdx])
            val nb = Color.blue(pixels[nextIdx])
            val nextLuma = (0.299 * nr + 0.587 * ng + 0.114 * nb).toInt()

            if (currentLuma > nextLuma) {
                hash = hash or (1L shl i)
            }
        }
        return hash
    }

    @PluginMethod
    fun startCapture(call: PluginCall) {
        // Reset state on new capture session
        lastHashSnapshot = emptyList()
        lastEmitTimestamp = 0
        // Trigger MediaProjection logic...
        call.resolve()
    }
}

