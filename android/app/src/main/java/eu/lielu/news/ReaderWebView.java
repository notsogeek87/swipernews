package eu.lielu.news;

import android.content.Context;
import android.util.AttributeSet;
import android.webkit.WebView;

/**
 * WebView qui sait dire quand elle défile.
 *
 * <p>La classe de base garde {@code onScrollChanged} protégé et n'offre aucun
 * écouteur : c'est la seule raison d'être de cette sous-classe. Le lecteur s'en
 * sert pour escamoter sa barre pendant la lecture (voir
 * {@link InAppBrowserActivity}).
 */
public class ReaderWebView extends WebView {

    /** Appelé à chaque défilement : position verticale et delta depuis la précédente. */
    public interface OnScrollListener {
        void onScroll(int scrollY, int dy);
    }

    private OnScrollListener listener;

    public ReaderWebView(Context context) {
        super(context);
    }

    public ReaderWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public ReaderWebView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    public void setOnScrollListener(OnScrollListener l) {
        this.listener = l;
    }

    @Override
    protected void onScrollChanged(int l, int t, int oldl, int oldt) {
        super.onScrollChanged(l, t, oldl, oldt);
        if (listener != null) listener.onScroll(t, t - oldt);
    }
}
