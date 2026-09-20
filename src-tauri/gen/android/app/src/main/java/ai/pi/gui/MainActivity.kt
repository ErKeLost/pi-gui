package ai.pi.gui

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The barcode-scanner plugin layers its native camera preview BENEATH the
    // WebView; an opaque WebView hides it (black viewfinder). Make the WebView
    // transparent once attached so the preview shows through page areas whose
    // HTML background is transparent.
    window.decorView.post { findWebView(window.decorView)?.setBackgroundColor(Color.TRANSPARENT) }
  }

  private fun findWebView(view: View?): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findWebView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }
}
