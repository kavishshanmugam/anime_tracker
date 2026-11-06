/**
 * Name shown to the user: the English title when there is one, otherwise the romaji title.
 * (`anime.title` stays the romaji title internally — it's the key for saved sources/progress.)
 */
export function displayTitle(a: { title: string; title_en?: string | null } | null | undefined): string {
  if (!a) return ''
  return a.title_en?.trim() || a.title
}
