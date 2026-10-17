package eu.lielu.news;

import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;

import java.util.regex.Pattern;

/**
 * Les couleurs de la feuille de résumé : celles de l'habillage ACTIF de l'app
 * (Flamme, Bleuté ou Sobre, en sombre ou en clair), pas une palette à part.
 *
 * Elles ne sont pas recopiées ici. Le web lit les variables CSS calculées de
 * {@code :root} (voir {@code themePalette()} dans index.html) et les transmet à
 * chaque ouverture, comme le reste des préférences : la couleur exacte de chaque
 * thème ne vit qu'à UN endroit, le {@code <style>}. Ajouter un thème au web
 * suffit donc, sans toucher au natif.
 *
 * Format reçu : sept couleurs {@code #rrggbb} séparées par des virgules, dans
 * l'ordre fond, surface, molten, redline, flare, ink, ash. Tout ce qui s'en
 * écarte — rien reçu, ancien web, valeur abîmée — retombe sur Flamme sombre.
 */
final class SummaryTheme {

    /** Flamme sombre, l'habillage d'origine : le repli quand rien de valide n'arrive. */
    static final String FLAMME =
        "#190501,#340a01,#631303,#951c04,#fa5838,#f7f6ff,#baadab";

    private static final Pattern SPEC =
        Pattern.compile("^(#[0-9a-fA-F]{6},){6}#[0-9a-fA-F]{6}$");

    final int bg, surface, molten, redline, flare, ink, ash;
    private final float density;

    private SummaryTheme(String spec, float density) {
        final String[] c = spec.split(",");
        bg = Color.parseColor(c[0]);
        surface = Color.parseColor(c[1]);
        molten = Color.parseColor(c[2]);
        redline = Color.parseColor(c[3]);
        flare = Color.parseColor(c[4]);
        ink = Color.parseColor(c[5]);
        ash = Color.parseColor(c[6]);
        this.density = density;
    }

    /** Valide la chaîne transmise ; le natif ne s'y fie jamais sans la regarder. */
    static boolean isValid(String spec) {
        return spec != null && SPEC.matcher(spec).matches();
    }

    static SummaryTheme parse(String spec, float density) {
        return new SummaryTheme(isValid(spec) ? spec : FLAMME, density);
    }

    private static int alpha(int color, int a) {
        return Color.argb(a, Color.red(color), Color.green(color), Color.blue(color));
    }

    private float dp(float v) {
        return v * density;
    }

    /** « .sheet__panel » : fond surface, coins de 8 dp en haut, liseré redline, jamais d'ombre. */
    Drawable panel() {
        final GradientDrawable g = new GradientDrawable();
        g.setColor(surface);
        g.setStroke(Math.round(dp(1)), redline);
        final float r = dp(8);
        g.setCornerRadii(new float[] { r, r, r, r, 0, 0, 0, 0 });
        // Le liseré du bas sort de l'écran : on ne le voit pas, comme sur le web.
        final LayerDrawable l = new LayerDrawable(new Drawable[] { g });
        l.setLayerInset(0, 0, 0, 0, -Math.round(dp(2)));
        return l;
    }

    /** « .sheet__grip » : la poignée, cendre à 40 %. */
    Drawable grip() {
        final GradientDrawable g = new GradientDrawable();
        g.setColor(alpha(ash, 0x66));
        g.setCornerRadius(dp(4));
        return g;
    }

    /** « .rail button » : carré aux coins de 4 dp, liseré redline, fond translucide. */
    Drawable fab() {
        final GradientDrawable g = new GradientDrawable();
        g.setColor(alpha(bg, 0x8C));
        g.setStroke(Math.round(dp(1.5f)), redline);
        g.setCornerRadius(dp(4));
        return new RippleDrawable(ColorStateList.valueOf(alpha(redline, 0x4D)), g, null);
    }

    /**
     * « .card__open » : le bouton plein, dégradé à 135 degrés. « molten » vers
     * « redline » plutôt que « surface » vers « molten » : sur le fond « surface » de
     * la feuille, le premier se confondrait avec elle.
     */
    Drawable primaryButton() {
        final GradientDrawable g = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR, new int[] { molten, redline });
        g.setCornerRadius(dp(4));
        return new RippleDrawable(ColorStateList.valueOf(alpha(ink, 0x33)), g, null);
    }

    /** « .iobtn » : transparent, liseré redline de 1,5 dp, coins de 4 dp. */
    Drawable secondaryButton() {
        final GradientDrawable g = new GradientDrawable();
        g.setColor(Color.TRANSPARENT);
        g.setStroke(Math.round(dp(1.5f)), redline);
        g.setCornerRadius(dp(4));
        return new RippleDrawable(ColorStateList.valueOf(alpha(redline, 0x4D)), g, null);
    }

    /** Trait de progression carré : piste redline à 30 %, avancement flare. */
    Drawable progress() {
        final GradientDrawable track = new GradientDrawable();
        track.setColor(alpha(redline, 0x4D));
        track.setCornerRadius(dp(1));
        final GradientDrawable bar = new GradientDrawable();
        bar.setColor(flare);
        bar.setCornerRadius(dp(1));
        final LayerDrawable l = new LayerDrawable(new Drawable[] {
            track, new ClipDrawable(bar, Gravity.START, ClipDrawable.HORIZONTAL) });
        l.setId(0, android.R.id.background);
        l.setId(1, android.R.id.progress);
        return l;
    }
}
