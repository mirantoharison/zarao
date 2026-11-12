import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDownUp, Check, RotateCcw, Save, SlidersVertical, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/i18n";
import { EQ_CUSTOM_MAX, EQ_CUSTOM_NAME_MAX, EQ_FREQUENCIES, EQ_GAIN_LIMIT, EQ_PITCH_LIMIT, EQ_PRESETS, applyCustomPreset, deleteCustomPreset, responseDb, saveCustomPreset, setEqualizerBand, setEqualizerEnabled, setEqualizerPitch, setEqualizerPreset, useEqualizer } from "@/lib/equalizer";
import { BUILTIN_PRESET_ICONS, DEFAULT_PRESET_ICON, PRESET_ICONS, presetIcon } from "@/lib/preset-icons";
import { cn } from "@/lib/utils";

/** Durée (ms) pendant laquelle courbe et curseurs glissent vers un préréglage ; hors de cette fenêtre ils suivent la souris sans retard. */
const PRESET_GLIDE_MS = 450;
/** Hauteur de la zone de curseurs (rem) : sert aussi à placer la ligne du 0 dB et les graduations. */
const SLIDER_REM = 11;
/** Diamètre du pouce du Slider (px, `size-4`) : Radix garde son centre à l'intérieur de la piste, ce qui décale les extrémités. */
const THUMB_PX = 16;
/** Zones du spectre : indices des bandes concernées (1 colonne par bande). Sert au bandeau Graves / Médiums / Aigus sous les curseurs. */
const ZONES = [
  { key: "low", span: 4, tone: "border-primary/70" },
  { key: "mid", span: 3, tone: "border-primary/45" },
  { key: "high", span: 3, tone: "border-primary/25" },
] as const;
const sameGains = (a: number[], b: number[]) => a.length === b.length && a.every((g, i) => g === b[i]);
const label = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const sign = (g: number) => (g > 0 ? "+" : "");
const fmtPitch = (p: number) => `${sign(p)}${Number.isInteger(p) ? p : p.toFixed(1)}`;

/**
 * Barre d'un curseur, remplie DEPUIS LE CENTRE (0) : vers le haut / la droite pour une valeur positive, vers le bas / la gauche pour une négative.
 * IMPORTANT : la position suit la formule de Radix pour le pouce (pourcentage + correction en px), sinon la barre
 * ne rejoindrait pas le pouce aux extrémités. `horizontal` : curseur horizontal (transposition) au lieu de vertical (bandes).
 */
function centerBar(value: number, limit = EQ_GAIN_LIMIT, horizontal = false): CSSProperties | null {
  if (value === 0) return null;
  const pct = ((value + limit) / (2 * limit)) * 100;
  const px = THUMB_PX / 2 - (THUMB_PX / 100) * pct;
  const [start, size] = value > 0 ? ["50%", `calc(${pct - 50}% + ${px}px)`] : [`calc(${pct}% + ${px}px)`, `calc(${50 - pct}% + ${-px}px)`];
  return horizontal ? { left: start, width: size } : { bottom: start, height: size };
}

/** Repère de la courbe (unités du viewBox SVG). */
const W = 100, H = 40, MID = H / 2;
/** Étendue verticale de la courbe (dB de part et d'autre du 0). */
const CURVE_RANGE_DB = 18;

/** Courbe de réponse en fréquence : montre l'effet global des réglages, alignée sur les colonnes de curseurs. */
function ResponseCurve({ gains, gliding }: { gains: number[]; gliding: boolean }) {
  const { line, area } = useMemo(() => {
    const db = responseDb(gains);
    // IMPORTANT : plage ±18 dB et non ±12 — des bandes voisines poussées au maximum s'additionnent et dépassent 12 dB,
    // ce qui sortait de la zone et coupait la courbe. Au-delà de ±18 elle est bornée, avec une marge de 3 unités pour le trait.
    const pts = db.map((v, k) => `${((k / (db.length - 1)) * W).toFixed(2)},${(MID - (Math.max(-CURVE_RANGE_DB, Math.min(CURVE_RANGE_DB, v)) / CURVE_RANGE_DB) * (MID - 3)).toFixed(2)}`);
    return { line: `M${pts.join(" L")}`, area: `M0,${MID} L${pts.join(" L")} L${W},${MID} Z` };
  }, [gains]);
  // La propriété CSS `d` permet d'animer le tracé d'un état à l'autre (Chromium/WebView2) ; l'attribut `d` sert de repli.
  const glide = gliding ? "[transition:d_0.45s_ease-out]" : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-20 w-full overflow-visible text-primary" aria-hidden>
      <defs>
        <linearGradient id="eq-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={MID} y2={MID} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <path d={area} style={{ d: `path("${area}")` } as CSSProperties} fill="url(#eq-curve-fill)" className={glide} />
      <path d={line} style={{ d: `path("${line}")` } as CSSProperties} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={glide} />
    </svg>
  );
}

/** Égaliseur graphique 10 bandes en volet latéral (même présentation que les paroles). Réglages mémorisés d'une session à l'autre. */
export function EqualizerPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const { t } = useI18n();
  const eq = useEqualizer();
  // Toucher à un réglage alors que l'égaliseur est éteint l'allume : l'utilisateur attend d'entendre ce qu'il règle.
  const touch = () => { if (!eq.enabled) setEqualizerEnabled(true); };

  // Animation : seulement lors d'un changement de préréglage (une transition pendant un glissement donnerait du retard).
  const [gliding, setGliding] = useState(false);
  const glideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(glideTimer.current), []);
  const glide = (apply: () => void) => {
    setGliding(true);
    apply();
    touch();
    clearTimeout(glideTimer.current);
    glideTimer.current = setTimeout(() => setGliding(false), PRESET_GLIDE_MS);
  };

  // Préréglage correspondant aux réglages actuels ("" = réglages modifiés à la main).
  const customNames = Object.keys(eq.custom);
  const builtinMatch = Object.keys(EQ_PRESETS).find((n) => sameGains(eq.gains, EQ_PRESETS[n]));
  const customMatch = customNames.find((n) => sameGains(eq.gains, eq.custom[n].gains));
  const selected = builtinMatch ? `b:${builtinMatch}` : customMatch ? `c:${customMatch}` : "";
  const pick = (value: string) => {
    const [kind, ...rest] = value.split(":");
    const name = rest.join(":");
    glide(() => (kind === "b" ? setEqualizerPreset(name) : applyCustomPreset(name)));
  };

  // Bande survolée ou au focus clavier : son rôle s'affiche dans l'encadré d'aide sous les curseurs.
  const [focusBand, setFocusBand] = useState<number | null>(null);
  const bandText = (i: number, part: "t" | "d") => t(`eq.band.${i}.${part}` as Parameters<typeof t>[0]);

  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState(DEFAULT_PRESET_ICON);
  const [pickerOpen, setPickerOpen] = useState(false);
  const NewIcon = presetIcon(newIcon);
  const [justSaved, setJustSaved] = useState(false);
  const canSave = newName.trim().length > 0 && (customNames.includes(newName.trim()) || customNames.length < EQ_CUSTOM_MAX);
  const save = () => {
    if (!canSave || !saveCustomPreset(newName, newIcon)) return;
    setNewName(""); setPickerOpen(false); setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  };

  const barGlide = gliding && "transition-[bottom,height] duration-[450ms] ease-out";

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <SlidersVertical className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="flex-1 truncate text-sm font-medium">{t("eq.title")}</h3>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} title={t("search.close")}><X /></Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <ScrollArea className="size-full" viewportProps={{ className: "[&>div]:block!" }}>
            <div className="space-y-4 p-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={eq.enabled} onCheckedChange={(v) => setEqualizerEnabled(v === true)} />
                {t("eq.enable")}
              </label>

              {/* Préréglages : une liste (intégrés + les vôtres) au lieu d'une rangée de boutons. */}
              <div className="flex gap-1.5">
                <Select value={selected} onValueChange={pick}>
                  <SelectTrigger className="h-8! min-w-0 flex-1" aria-label={t("eq.presets")}>
                    <SelectValue placeholder={t("eq.modified")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t("eq.builtin")}</SelectLabel>
                      {Object.keys(EQ_PRESETS).map((name) => {
                        const Icon = BUILTIN_PRESET_ICONS[name] ?? SlidersVertical;
                        return <SelectItem key={name} value={`b:${name}`}><Icon /> {t(`eq.preset.${name}` as Parameters<typeof t>[0])}</SelectItem>;
                      })}
                    </SelectGroup>
                    {customNames.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{t("eq.mine")}</SelectLabel>
                        {customNames.map((name) => {
                          const Icon = presetIcon(eq.custom[name].icon);
                          return <SelectItem key={name} value={`c:${name}`}><Icon /> {name}</SelectItem>;
                        })}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {/* Suppression : seulement quand un de vos préréglages est celui en cours. */}
                {customMatch && !builtinMatch && (
                  <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0 text-destructive hover:bg-destructive/15 hover:text-destructive animate-in fade-in zoom-in-95 duration-200" aria-label={t("eq.deleteCustom", { n: customMatch })} title={t("eq.deleteCustom", { n: customMatch })} onClick={() => deleteCustomPreset(customMatch)}><Trash2 /></Button>
                )}
              </div>

              {/* Enregistrer les réglages actuels : icône + nom. */}
              <div className="space-y-2">
                <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
                  <Button type="button" size="icon" variant="outline" className="size-8 shrink-0" aria-expanded={pickerOpen} aria-label={t("eq.icon")} title={t("eq.icon")} onClick={() => setPickerOpen((o) => !o)}><NewIcon /></Button>
                  <Input value={newName} maxLength={EQ_CUSTOM_NAME_MAX} className="h-8" placeholder={t("eq.customName")} aria-label={t("eq.customName")} onChange={(e) => setNewName(e.target.value)} />
                  <Button type="submit" size="sm" variant="outline" disabled={!canSave} title={customNames.length >= EQ_CUSTOM_MAX ? t("eq.customFull") : undefined}>{justSaved ? <Check className="text-emerald-500" /> : <Save />} {t("eq.saveCustom")}</Button>
                </form>
                {pickerOpen && (
                  <div className="grid grid-cols-7 gap-1 rounded-md border p-1.5 animate-in fade-in slide-in-from-top-1 duration-200" role="listbox" aria-label={t("eq.icon")}>
                    {Object.entries(PRESET_ICONS).map(([key, Icon]) => (
                      <button key={key} type="button" role="option" aria-selected={key === newIcon} onClick={() => { setNewIcon(key); setPickerOpen(false); }}
                        className={cn("grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", key === newIcon && "bg-secondary text-foreground ring-1 ring-ring")}><Icon className="size-4" /></button>
                    ))}
                  </div>
                )}
              </div>

              <div className={cn("space-y-1 transition-opacity", !eq.enabled && "opacity-50")}>
                {/* Courbe : même décalage à gauche que la colonne des graduations, pour s'aligner sur les curseurs. */}
                <div className="flex gap-0.5">
                  <div className="w-8 shrink-0" />
                  <div className="min-w-0 flex-1"><ResponseCurve gains={eq.gains} gliding={gliding} /></div>
                </div>

                <div className="flex gap-0.5">
                  {/* Graduations en dB : mêmes lignes que les colonnes (valeur, curseur, fréquence) pour rester alignées. */}
                  <div className="flex w-8 shrink-0 flex-col items-end gap-2 pr-1 text-[0.65rem] tabular-nums text-muted-foreground">
                    <span className="h-4" />
                    <div className="relative w-full" style={{ height: `${SLIDER_REM}rem` }}>
                      <span className="absolute right-0" style={{ top: THUMB_PX / 2, translate: "0 -50%" }}>+{EQ_GAIN_LIMIT}</span>
                      <span className="absolute right-0 top-1/2 -translate-y-1/2">0</span>
                      <span className="absolute right-0" style={{ bottom: THUMB_PX / 2, translate: "0 50%" }}>−{EQ_GAIN_LIMIT}</span>
                    </div>
                    <span className="h-4" />
                  </div>

                  <div className="relative flex flex-1 justify-between gap-0.5">
                    {/* Ligne du 0 dB, derrière les curseurs : milieu de la zone des curseurs (valeur 1rem + écart 0,5rem + moitié de la hauteur). */}
                    <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${1 + 0.5 + SLIDER_REM / 2}rem` }} />
                    {EQ_FREQUENCIES.map((hz, i) => {
                      const bar = centerBar(eq.gains[i]);
                      return (
                        <div key={hz} className="relative flex flex-1 flex-col items-center gap-2" title={`${label(hz)} Hz — ${bandText(i, "t")}`}
                          onPointerEnter={() => setFocusBand(i)} onPointerLeave={() => setFocusBand(null)} onFocus={() => setFocusBand(i)} onBlur={() => setFocusBand(null)}>
                          <span className="h-4 text-[0.65rem] leading-4 tabular-nums text-muted-foreground">{sign(eq.gains[i])}{eq.gains[i]}</span>
                          <div className="relative w-full" style={{ height: `${SLIDER_REM}rem` }}>
                            {/* IMPORTANT : la tige est dessinée AVANT le curseur (et le curseur passe au-dessus, z-10) : elle disparaît
                                derrière le bouton au lieu de le traverser. */}
                            {bar && <div className={cn("pointer-events-none absolute left-1/2 w-1.5 -translate-x-1/2 bg-primary", eq.gains[i] > 0 ? "rounded-t-full" : "rounded-b-full", barGlide)} style={bar} />}
                            {/* La plage native (remplie depuis le bas) est masquée : `bar` la remplace, depuis le centre. */}
                            <Slider orientation="vertical" hideTrack className="relative z-10 h-full min-h-0 [&_[data-slot=slider-range]]:opacity-0" min={-EQ_GAIN_LIMIT} max={EQ_GAIN_LIMIT} step={1} value={[eq.gains[i]]}
                              onValueChange={([v]) => { setEqualizerBand(i, v); touch(); }} />
                          </div>
                          <span className="h-4 text-[0.65rem] leading-4 text-muted-foreground">{label(hz)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Zones : repères Graves / Médiums / Aigus, alignés sur les colonnes de curseurs (même décalage que la courbe). */}
              <div className="flex gap-0.5">
                <div className="w-8 shrink-0" />
                <div className="grid flex-1 grid-cols-10 gap-0.5">
                  {ZONES.map((z) => (
                    <div key={z.key} style={{ gridColumn: `span ${z.span}` }} className={cn("border-t-2 pt-1 text-center text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground", z.tone)}>
                      {t(`eq.zone.${z.key}` as Parameters<typeof t>[0])}
                    </div>
                  ))}
                </div>
              </div>

              {/* Aide : rôle de la bande survolée, ou explication générale. */}
              <div className="min-h-24 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed" aria-live="polite">
                {focusBand === null ? (
                  <p className="text-muted-foreground">{t("eq.explain")}</p>
                ) : (
                  <p key={focusBand} className="animate-in fade-in duration-200">
                    <span className="block text-sm font-medium">{label(EQ_FREQUENCIES[focusBand])} Hz · {bandText(focusBand, "t")}</span>
                    <span className="text-muted-foreground">{bandText(focusBand, "d")}</span>
                  </p>
                )}
              </div>

              {/* Hauteur (pitch) : transposition en demi-tons sans changer la vitesse ; indépendante de la case « Activer ». */}
              <section className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <ArrowDownUp className="size-4 shrink-0 text-muted-foreground" />
                  <h4 className="flex-1 text-sm font-medium">{t("eq.pitch")}</h4>
                  <span className={cn("text-sm tabular-nums", eq.pitch === 0 && "text-muted-foreground")}>{fmtPitch(eq.pitch)} {t("eq.pitchUnit")}</span>
                  <Button type="button" size="icon" variant="ghost" className={cn("size-7 transition-opacity", eq.pitch === 0 && "pointer-events-none opacity-0")} aria-label={t("eq.pitchReset")} title={t("eq.pitchReset")} tabIndex={eq.pitch === 0 ? -1 : 0} onClick={() => setEqualizerPitch(0)}><RotateCcw /></Button>
                </div>
                <div className="relative h-4">
                  <Slider className="h-full [&_[data-slot=slider-range]]:opacity-0" min={-EQ_PITCH_LIMIT} max={EQ_PITCH_LIMIT} step={0.5} value={[eq.pitch]} onValueChange={([v]) => setEqualizerPitch(v)} aria-label={t("eq.pitch")} />
                  {eq.pitch !== 0 && <div className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary" style={centerBar(eq.pitch, EQ_PITCH_LIMIT, true) ?? undefined} />}
                </div>
                <div className="flex justify-between text-[0.65rem] tabular-nums text-muted-foreground">
                  <span>−{EQ_PITCH_LIMIT}</span><span>−{EQ_PITCH_LIMIT / 2}</span><span>0</span><span>+{EQ_PITCH_LIMIT / 2}</span><span>+{EQ_PITCH_LIMIT}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("eq.pitchHint")}</p>
              </section>

              <p className="text-xs text-muted-foreground">{t("eq.hint")}</p>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
