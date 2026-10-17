package eu.lielu.news;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.widget.ScrollView;

/**
 * ScrollView qui grandit avec son contenu jusqu'à une hauteur maximale, puis
 * défile. Sans ça, un long résumé pousserait la feuille du résumé jusqu'en haut
 * de l'écran et ses boutons hors de portée du pouce.
 */
public class MaxHeightScrollView extends ScrollView {
    private int maxHeightPx = Integer.MAX_VALUE;

    public MaxHeightScrollView(Context context) {
        super(context);
    }

    public MaxHeightScrollView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setMaxHeightPx(int px) {
        if (px == maxHeightPx) return;
        maxHeightPx = px;
        requestLayout();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        if (maxHeightPx != Integer.MAX_VALUE) {
            heightMeasureSpec = View.MeasureSpec.makeMeasureSpec(maxHeightPx, View.MeasureSpec.AT_MOST);
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    }
}
