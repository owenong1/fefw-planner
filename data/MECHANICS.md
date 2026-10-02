# Game mechanics: what's confirmed, what isn't

This answers the questions in PLAN.md §0 as far as public sources allow. The RNG checker and army builder depend on these.

## Confirmed

| Topic | Finding | Source |
|---|---|---|
| Stats | HP, Str, Mag, Spd, Dex, Def, Res, Lck, Cha grow on level-up. Build and Mov exist but have no growth rates. | Game8, Fextralife |
| Growth model | Each stat has an independent % chance of +1 per level-up. **Class growths are added to personal growths.** | Game8 "Growth Rates Explained" |
| Base classes | Commoner (and Noble) add no growth modifiers. | Game8 |
| Class tiers | Beginner (Lv 5, Renown 1) → Specialty (Lv 20, Renown 4) → Advanced (Lv 35, Renown 8) → Master (Lv 45) → Divine (item). Each needs a license and weapon-skill ranks. Elephant Rider uses its own Elephant License (Lv 35). | Game8 classes page |
| Levels | The level ("Ideal: Lv. 45" for Master) keeps counting up and does not reset on class change. Tiers are gated by level. | Inferred from class requirements |
| Class restrictions | Goliath (Heavyweight Class) and Orchel (Solid and Sturdy) cannot become cavalry or flying classes. Otherwise any unit can be any class whose requirements they meet. | Personal skill text |
| Base stats | Published "at Level 1, without any class". This implies classes add flat stat bonuses on top. | Fextralife |
| Routes | Prologue (shared) → Part I (one of four lord routes, chapters 1–~12) → Part II: War → Part III: Salvation (shared by every route). | Game8 recruitment page |
| Recruitment | Part I recruits need Support level (1–3) with the lord, Renown level, and usually a request (gold, items, a paralogue, dialogue). The requirements differ by route. | Game8 |
| Paralogues | Limited windows on an in-game calendar. Several are required for recruits on other routes. | Game8 |

## Affects the RNG checker. Still unknown

- **Growths over 100%**: the highest combined growth in the data is exactly 100% (Theodora's HP as The Eternal), and several reach 95%. Stat boosters or other modifiers could push past 100%. Treat it as +1 guaranteed plus (p−100)% for +2 until shown otherwise.
- **Empty level-ups / minimum stat gains**: no source mentions a guarantee. Assume none.
- **Charioteer's Path / Elephant Rider's Path**: "Unit's growth rate increases with level". The formula is undocumented. The RNG checker should flag these classes as approximate.
- **Mu's Signs of Growth**: +20% to every growth (Game8 vs Fextralife base growths differ by exactly 20 on every stat). Game8's table already includes it.
- **Class stat bonuses**: published, but not imported yet. Game8's per-class pages (linked from its class list, e.g. Guardian: +3 HP, +1 Str, +1 Spd, +3 Def, +4 Res; Gladiator: +1 HP, +1 Str) have a "Bonus" column next to the growth modifiers, described as fixed stats added when changing into the class. The checker needs them to separate level-up gains from class bonuses; until they're in `classes.json` the RNG page carries a "not reliable yet" note and users must enter stats with the class bonus removed. Unknown: whether the previous class's bonus is removed on class change.
- **Stat caps**: not published yet.
- **Base level**: published base stats are at Level 1 for most units. Recruits probably join at a higher level (auto-levelled?). Unknown.

## Affects the army builder. Still unknown

- Whether one save can carry units across routes ("How to Merge Character Stats Between Routes" and "Can You Recruit a Unit on Multiple Routes?" are Game8 article titles we haven't read).
- Deploy limits per chapter.
- Klapka needs "Theodora's Path must be cleared", which suggests multi-route progress matters.

## Source disagreements

See `data/import-report.txt` after each import. Known so far:
- Ursula HP growth: 40% (Game8) vs 50% (Fextralife).
- RPG Site disagrees with Game8 on a few support/renown values (e.g. Peter on Dietrich's route: Renown 8 vs 9; Guzran on Cai's route: listed as automatic). Game8 is used.
