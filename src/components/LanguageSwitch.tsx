import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n, type Lang } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Drapeaux en SVG inline.
 * IMPORTANT : pas d'émojis drapeaux — Windows ne les affiche pas (on verrait « FR » / « GB » en lettres).
 */
function FlagFR({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 3 2" className={cn("h-3.5 w-5 shrink-0 rounded-[2px] ring-1 ring-border", className)} aria-hidden>
      <rect width="1" height="2" fill="#0055A4" />
      <rect x="1" width="1" height="2" fill="#FFFFFF" />
      <rect x="2" width="1" height="2" fill="#EF4135" />
    </svg>
  );
}

function FlagGB({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 30" className={cn("h-3.5 w-5 shrink-0 rounded-[2px] ring-1 ring-border", className)} aria-hidden>
      <clipPath id="gb-clip"><rect width="60" height="30" /></clipPath>
      <g clipPath="url(#gb-clip)">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2" />
        <path d="M30,0 V30 M0,15 H60" stroke="#FFFFFF" strokeWidth="10" />
        <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

/** Sélecteur de langue (français / anglais uniquement), avec drapeaux. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
      <SelectTrigger className={cn("h-9 w-40 text-base", className)} aria-label={t("lang.label")} title={t("lang.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {/* Le drapeau est dans l'item : Radix le reprend dans le bouton fermé, une seule source pour les deux. */}
        <SelectItem value="fr"><FlagFR /> {t("lang.fr")}</SelectItem>
        <SelectItem value="en"><FlagGB /> {t("lang.en")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
