# PaperCounter

The paper balance pill in the HUD, top-left.

Markup: `pw-counter` with the Lucide `files` icon in a white disc, `pw-counter__value` and, for a moment after a change, `pw-counter__delta` (+300 or −120). Give it `role="status"` and an `aria-label` with the full number. The consumer formats the number with thousands separators and decides how long the delta stays.
