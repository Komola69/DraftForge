package com.draftforge.app;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;

public class FloatingService extends Service {
    private WindowManager windowManager;
    private View floatingView;
    private FrameLayout container;
    private WindowManager.LayoutParams params;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        
        // Root container
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.parseColor("#0a0e1a")); // DraftForge Dark Navy
        
        int LAYOUT_FLAG;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            LAYOUT_FLAG = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            LAYOUT_FLAG = WindowManager.LayoutParams.TYPE_PHONE;
        }

        // Overlay dimensions: 350dp x 400dp (approximate mini-view)
        float density = getResources().getDisplayMetrics().density;
        int width = (int)(360 * density);
        int height = (int)(420 * density);

        params = new WindowManager.LayoutParams(
                width, height,
                LAYOUT_FLAG,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);

        params.gravity = Gravity.TOP | Gravity.LEFT;
        params.x = 0;
        params.y = 100;

        // WebView for PWA
        WebView webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, 
                FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webView.setWebViewClient(new WebViewClient());
        
        // Load the capacitor web server URL or local asset
        // Since Capacitor local server might be sleeping if the main activity is dead,
        // we load the raw asset which is fully self-contained PWA.
        webView.loadUrl("file:///android_asset/public/index.html");
        
        // Close button wrapper (to make dragging easy too)
        FrameLayout topBar = new FrameLayout(this);
        topBar.setBackgroundColor(Color.parseColor("#111827"));
        topBar.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, (int)(40 * density)));
        
        Button closeBtn = new Button(this);
        closeBtn.setText("X");
        closeBtn.setTextColor(Color.WHITE);
        closeBtn.setBackgroundColor(Color.TRANSPARENT);
        FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(
                (int)(40 * density), (int)(40 * density), Gravity.RIGHT);
        closeBtn.setLayoutParams(btnParams);
        closeBtn.setOnClickListener(v -> stopSelf());
        
        topBar.addView(closeBtn);
        
        // Add to main container
        container.addView(webView);
        container.addView(topBar); // Add top bar over webview
        floatingView = container;
        
        // Drag logic attached to top bar
        topBar.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = params.x; initialY = params.y;
                        initialTouchX = event.getRawX(); initialTouchY = event.getRawY();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        windowManager.updateViewLayout(floatingView, params);
                        return true;
                }
                return false;
            }
        });

        windowManager.addView(floatingView, params);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (floatingView != null) windowManager.removeView(floatingView);
    }
}
