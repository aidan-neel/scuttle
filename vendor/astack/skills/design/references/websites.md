# Company and product websites

Method for a site that sells something: a landing page, a company, product, shop, studio, venue, SaaS, or game site. It is adapted from [Taste Skill](https://github.com/Leonxlnx/taste-skill) (MIT). Its rules sit on top of the [style spec](style-spec.md). The spec still sets the look, and nothing here replaces the variant pick, the verification widths, or the motion values. The numbers below are defaults for websites. A project's own design replaces them where it speaks.

The bar: a stranger knows in five seconds what is sold and to whom, every screen shows the real thing, and the page looks made for this client.

## Name the kind first

Write the kind on the brief's first line. It decides what leads each screen.

| Brief | Kind | What leads |
|---|---|---|
| App, SaaS, AI, developer tool, fintech | software | The product's own UI as live HTML, showing what it works on (a code-review tool shows a diff with its Accept action). Never a generic dashboard. |
| A game | gaming | Its name and genre in the h1, its world as full-bleed key art |
| Hardware or a device | tech | Photographs of the device, big and whole |
| Any other physical product | product | Photographs of the product, a different view in each section |
| People are hired: clinic, firm, agency, trade | service | Photographs of the people, rooms, and work |
| People come to it: cafe, shop, hotel, gym | place | Photographs, 8 to 20 on the page. The visit block (street, hours, directions) on screen two |

Shader effects, 3D scenes, ambient loops, and dark tech grounds belong only on software, gaming, and tech pages, one effect per page at most. A cafe, clinic, or shop gets photographs, flat color, and type.

## Layout

- **One section per screen.** The hero is alone on the first screen at 1440x900 and 390x844, with its main button inside it. Every later section is one or two screens tall, its heading first and top-aligned, with nothing of the next section's heading showing. A short block merges into the section above. Never center a lone block in an empty screen.
- **Equal edges.** Every block sits on the same left and right content lines or the grid's columns. Nothing hangs out to one side, and nothing scrolls sideways at any verified width.
- **Separate sections** with a full-width ground change or space, not rules, shadows, or an inset colored box.
- **One object never carries the page.** The product whole leads the hero and two more sections at most. Its use, parts up close, a diagram, or a context photograph carries the rest.
- **One system.** One button pair, one card style, one radius scale, one link look, and two boxes deep at most.
- **No page furniture**: no popups, newsletter modals, chat bubbles, back-to-top buttons, or award strips. Nothing is fixed but the header and, on a phone, one action bar.

## Pictures

- **Every visual renders** at every verified width. An effect the browser refuses shows a still fallback, never an empty frame.
- **No caption under a picture.** A heading names the set. A sold item's name and price sit inside its card. Photo credits go in one footer line.
- **Real photographs where they fit.** With no client photographs, use openly licensed stand-ins of the same kind of thing and list each one in the hand-off as the client's to replace. Never pass a stand-in off as the client's product, people, or place.
- **Real icons** for real tools the product works with, in their own colors. Never a drawn look-alike of a real logo.
- **The client's own assets get slots.** A trailer, screenshots, or key art the brief names each get a finished frame now, with a stand-in and a comment naming the file it waits for.

## Copy

Write it before the layout, per step 5 of the workflow.

1. **The h1 names the category,** plus the buyer or the place for a brand nobody knows, in 2 to 8 words ("Shift planning for restaurant teams", "Bakery on Mill Street, Leith"). Never a riddle, a command, or a mood.
2. **The first screen holds one hard fact**: a number, a place, a price, or a date from the brief.
3. **Every heading has a noun** that names a thing ("Rooms and prices", "Works with your tools"). No questions as headings, no colon headings, and one figure of speech per page at most, never in the h1.
4. **Buttons are a verb plus what the visitor gets,** 1 to 5 words ("Book a room", "Start a free trial"). Never "Learn more", "Discover", "Explore", or "Click here".
5. **Few actions, one wording each.** At most two in the hero (one on a place). The main action reads the same in the nav, the hero, and the close.
6. **Short copy.** One line to two sentences under a heading. A card body at most 25 words. Around 60 to 80 words per screen on a software page, fewer elsewhere. Spend words where the brief knows most, so sections differ in length.
7. **Numbers sit in sentences with their unit** ("4.5 hours a week"), and uneven where real.
8. **Forms:** a label says what goes in. An error names the field and what to type. The sent line names what was sent.

### Nothing invented

- Prices, hours, addresses, and dates come from the brief. On a place, plausible hours and prices for the trade may be assumed. List every assumed value in the hand-off.
- No invented reviews, ratings, testimonials, customer logos, statistics, or press lines. Without proof, show a strip of plain facts from the brief, or nothing.
- No placeholders or `#` links. Write the real words or leave the element out.
- This is stricter than the workflow's realistic-content step and anti-slop rule 7: on a public site, the client's own claims are never invented or labeled as sample. Only a product UI mock inside the page may hold invented sample data, such as names and amounts in a dashboard.
- A coined brand name is never a dictionary word, an existing business, or a name models keep coining (Kestrel, Halcyon, Lumen, Nimbus, Acme, Northwind). People's names come only from the brief.

### Contacts the brief doesn't give

- **Address:** street and district only, never a house number, postcode, or coordinates. No street given: the district only.
- **Phone:** none unless the brief gives one.
- **Email:** a form, or a button whose `mailto:` uses a `.example` domain. Never print an email address.
- **No company register, VAT, or tax numbers** unless the brief gives them.
- **Maps:** no embedded map. "Get directions" opens a map search for the street and district.

### Copy tells

These read as model-written. One proves little. Clusters are the signal.

| Tell | Fix |
|---|---|
| Filler words: seamless, effortless, cutting-edge, unlock, elevate, supercharge, robust, powerful | The fact the word stands in for |
| Virtue words about the client: honest, calm, quiet, simply, thoughtful | An admission or a fact |
| Stock lines: "Say goodbye to", "Whether you're A or B", "X made simple" | Say what it does |
| Two-fragment headings ("Twelve rooms. Three ways to stay."), more than once | A name with a claim under it, or a plain sentence |
| Contrast frames ("not X but Y", "rather than", "without the"), more than twice | The positive fact alone |
| A strip of three or four figures over one-word labels | Each number in the sentence it proves |
| Invented specifics ("Batch No. 047", "38% fewer re-runs") | The brief's details, or a plainer line |
| A dry closer or moral on every paragraph | End on information |
| A footer sign-off ("Made in Rotterdam, fired at 1,260 degrees") | The legal row only |
| Process talk ("Below, you'll find", "Here are 3 reasons") | The page never talks about itself |
| Perfect evenness: every card the same length | Length follows the material |

Over-correction breeds its own tells. Banning em dashes breeds comma splices. Banning hype breeds the calm vocabulary above. Banning threes breeds pairs. List as many items as there are.

## Motion

On top of [motion.md](motion.md) and workflow step 9: the hero enters once on load, and the page's one hero moment plays inside its own section. Linked cards lift slightly and photos zoom 1.02 to 1.03 inside their frame on hover. Nothing fades in on scroll card by card, no parallax on text, no tilt, no carousels, and no timed tabs. A loop longer than 5 seconds gets a pause control.

## Checks

Add these to the [qa.md](qa.md) checklist and the verification round:

- [ ] The first screen names the category and the buyer or place, holds one hard fact, and shows the hero alone with its main button, at 1440x900 and 390x844.
- [ ] Every section is one or two screens tall, heading first, with no neighbor's heading in its screen.
- [ ] Every block sits on the shared content edges at every width.
- [ ] Every visual renders. No caption under any picture. No invented proof, placeholder, or printed contact.
- [ ] Buttons are a verb and an object, one wording per action, and no copy tell clusters.

## Hand-off additions

Beyond the [qa.md](qa.md) report, list: the kind, every assumed fact, every stand-in photograph and client slot with the file it waits for, and the `.example` contacts the client must replace.
