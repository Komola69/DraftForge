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

        // Send 100-byte micro-payload over the Capacitor Bridge
        val result = JSObject()
        result.put("hashes", hashes)
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
        // Trigger MediaProjection logic...
        call.resolve()
    }
}
