# Decision Journey & Background

This file captures the *reasoning* behind the project — the road taken, the options weighed, and what was rejected and why. CLAUDE.md holds the operational rules; this holds the "why" so decisions aren't silently reversed under pressure. Loaded on demand, not every session.

## The framing that changed everything: this is a portfolio piece

The platform's primary purpose is to **demonstrate the ability to architect and build a full-scale enterprise commerce platform** to prospective clients. It is not primarily a commercial product. A usable small-business product is a possible side effect but explicitly not a goal — those buyers are better served by Shopify/WooCommerce on price and ease, which we can't and won't try to beat.

This reframing inverts some otherwise-standard advice (see D-09 on build-vs-adopt). The audience is **technical decision-makers** (CTOs, architects), so demonstrated *judgment* matters as much as features. Hence the guiding principle: **depth over breadth**. A hero feature that genuinely sings, on a clean spine, with a sharp architecture doc, beats ten half-built modules. The biggest project risk is scope swallowing the demonstration.

## The competitive landscape (why this platform exists at all)

We compared commercetools, WooCommerce, Medusa, Intershop, and Magento. Key findings:
- **commercetools**: highest architectural ceiling (composable, MACH, multi-tenant SaaS) but closed-source and very expensive ($100k+/yr). We can't beat it on enterprise features and never will — nobody in the self-hosted camp does.
- **WooCommerce**: easiest to start, enormous ecosystem, but a single-store monolith on WordPress's blog-era data model. No native multi-tenancy. Low architectural ceiling for platform use.
- **Medusa**: the closest competitor. Node/TS, modular monolith, headless, Postgres — *almost exactly our architecture, already built and matured.* Our only real differentiator is native multi-tenancy (Medusa is multi-*store*, not multi-*tenant*).
- **Intershop/Magento**: enterprise/heritage, different stacks, not our lane.

Honest conclusion: our defensible position is "open-source and self-hostable like WooCommerce, but architecturally capable and natively multi-tenant like commercetools." That square is contested (Medusa is near it), not empty. For a *commercial* venture this thinness would be a serious problem; for a *portfolio* piece it's acceptable, because the goal is demonstration, not market capture.

## Decisions and the reasoning behind them

### D-01: Modular monolith first (not microservices)
The right domain boundaries are only learnable by building once. A wrong boundary between *distributed services* is brutal to move (network protocol + data migration + two pipelines); a wrong boundary *inside a monolith* is an afternoon's refactor. So we keep boundaries enforced but in-process, preserving the option to extract later. The three disciplines that keep that option real: no cross-module table access, network-strict events, per-module schemas.

### D-08: Microservices documented, not built
A commercetools-style **API surface does not require a microservices implementation** — the consumer can't tell the difference. Building a real fleet would burn the time budget on distributed-systems plumbing (service mesh, saga orchestration, eventual-consistency debugging) that demonstrates *ops* skill, not the *architecture* skill we're showcasing. The senior signal is deliberate non-distribution: show the clean extraction boundaries and explain when/which to split first. Building microservices for a demo can read as the *junior* move (complexity for its own sake).

### D-09: Build from scratch, NOT on top of Medusa
This is the most counter-intuitive decision. For a commercial venture, adopting Medusa would be rational — research confirmed Medusa 2.0 removed cross-module DB coupling and there's a published Postgres-RLS multi-tenancy pattern for it, so our wedge is buildable on top of it and would compress years into months. **But the goal is to demonstrate platform-building ability.** Building on Medusa would mean the hard parts (catalog, cart, order, pricing engine) are Medusa's work — that demonstrates *integration* skill, not *platform-architecture* skill, which is precisely what we're proving. So from-scratch is correct *for this goal specifically*. (If the goal were ever to become a real product, revisit this immediately.)

### D-05: Data store per bounded context
Not a platform-wide SQL-vs-NoSQL choice. ACID where money lives (Postgres), schema flexibility for catalog (JSONB/document), specialized faceted search (OpenSearch), speed for carts (Redis). This is also the honest way to demonstrate the "SQL + NoSQL" competence — right tool per context, never two databases just to show off (a senior evaluator spots the latter instantly).

### D-06 / D-07: Custom attributes promoted to core; search is the hero
Custom attributes (tenant-defined typed product attributes) are the commercetools/Intershop signature, they justify the NoSQL choice, and made searchable they power the hero feature. Search-at-scale-on-custom-attributes is the centerpiece because it's what enterprises care most about *and* it integrates catalog + attributes + multi-tenancy + NoSQL into one impressive flow.

### D-10 / D-11: Cloud demonstrated, not provisioned; Docker runnable, K8s written-not-deployed
Cloud strategy is a *reasoning* deliverable (provider-agnostic by design; AWS/Azure/GCP mapping; when-to-choose-which; Docker-vs-K8s judgment). Provisioning multi-cloud infra would prove SRE skill and cost time. Docker compose is made genuinely runnable (cheap, high-credibility); Kubernetes manifests are written to show the competence but not deployed. Same judgment muscle as D-08: reach for K8s when the platform earns it, not before.

## Things deliberately left open
- ORM: Prisma vs Drizzle — decide against real query patterns; kept behind repositories so it's a contained swap.
- Catalog store: Postgres JSONB vs a document store — may start JSONB to collapse operational surface.
- Whether to add a thin demo UI later purely to make the APIs visible to non-technical stakeholders.
- Whether differentiation should narrow to a specific vertical/operator workflow on top of multi-tenancy, since the Medusa ecosystem is drifting toward generic multi-tenancy too.

## The one principle to never lose
If time gets squeezed (it will), **protect the hero feature above everything**. Search-at-scale-on-custom-attributes carries the performance story enterprises care about and ties the other capabilities together. Everything else can flex down to "solid" or "documented"; the hero cannot.
