// Every word the public website says about the business.
//
// All of this used to be string literals inside the page components, which
// meant the copy was only changeable by someone who could edit TypeScript and
// redeploy. A daycare that wants to rename a service, drop a requirement, or
// rewrite the reasons people should choose them should not need a developer.
//
// So it lives here as a shape plus a default, and the saved copy is merged
// over the default in lib/settings.ts. The defaults are exactly what the site
// shipped with, which is what makes this safe: a business that never opens
// the editor sees no change at all, and one that clears a field back to blank
// gets a blank rather than the default sneaking back.
//
// What is NOT here: prices (Pricing tab), the name/address/phone/hours
// (Website tab), reviews (their own section), and the gallery and hero photos
// (uploaded, stored as rows). Those already had homes. Team headshots are the
// exception — they live here with the name and bio they belong to, so a team
// member is one row in one editor rather than two halves in two places.

export interface Seo {
  title: string;
  description: string;
}

/** The eyebrow/title/description trio every <Section> takes. */
export interface Heading {
  eyebrow: string;
  title: string;
  description: string;
}

/** One of the small bordered boxes: a bold line and a paragraph. */
export interface Card {
  title: string;
  body: string;
}

/** The top of an inner page — heading plus the photo beside it. */
export interface Hero {
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}

/** The accent-coloured band at the foot of a page. */
export interface Cta {
  title: string;
  description: string;
}

/** A service tile on the home page. */
export interface ServiceItem {
  href: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  // A file in /public, or an uploaded photo as a data URL. Headshots render
  // at 112px and are resized on upload, so they stay small enough to sit in
  // the settings row alongside the words they belong with — which is the
  // point: one row in one editor is the whole team member.
  photo: string;
}

export interface SiteContent {
  /** The home page headline. Not the kiosk tagline, which is an instruction. */
  tagline: string;
  /** The sentence under the logo in the footer, on every page. */
  footerBlurb: string;
  /** Fallback for every CTA band that does not set its own wording. */
  cta: Cta;
  home: {
    seo: Seo;
    intro: string;
    primaryCta: string;
    secondaryCta: string;
    offer: Heading;
    services: ServiceItem[];
    why: Heading;
    valueProps: Card[];
    teamTeaser: Heading;
    teamLinkLabel: string;
    reviewsHeading: Heading;
  };
  daycare: {
    seo: Seo;
    hero: Hero;
    how: Heading;
    options: Card[];
    note: string;
    requirements: Heading;
    requirementItems: string[];
    extra: Heading;
    extraLinkLabel: string;
    extraLinkHref: string;
    cta: Cta;
  };
  boarding: {
    seo: Seo;
    hero: Hero;
    included: Heading;
    amenities: Card[];
    goodToKnow: Heading;
    goodToKnowItems: string[];
    note: string;
    cta: Cta;
  };
  bath: {
    seo: Seo;
    hero: Hero;
    included: Heading;
    items: Card[];
    note: string;
    cta: Cta;
  };
  walking: {
    seo: Seo;
    hero: Hero;
    how: Heading;
    options: Card[];
    note: string;
    cta: Cta;
  };
  prices: { seo: Seo; heading: Heading };
  gallery: { seo: Seo; heading: Heading };
  about: {
    seo: Seo;
    eyebrow: string;
    title: string;
    intro: string;
    teamHeading: Heading;
    team: TeamMember[];
    approach: Heading;
  };
  contact: { seo: Seo; heading: Heading };
}

export const DEFAULT_CONTENT: SiteContent = {
  tagline: "The home away from home for your furry best friend.",
  footerBlurb:
    "Daycare, cage-free boarding, bathing, and walking — all in one pack-loving spot.",
  cta: {
    title: "Ready to give your dog their new favorite place?",
    description:
      "Book a meet & greet, or reach out with any questions — we usually reply the same day.",
  },

  home: {
    seo: {
      title: "Dog Daycare & Cage-Free Boarding",
      description:
        "Supervised daycare, cage-free overnight boarding, bathing, and dog walking. Book a meet & greet today.",
    },
    intro:
      "Dogs are pack animals — they need to move, sniff, run, and socialize. We give them a fun, safe, supervised place to do exactly that, every single day.",
    primaryCta: "Enroll Now",
    secondaryCta: "Reserve Boarding",
    offer: {
      eyebrow: "What we offer",
      title: "Everything your dog's routine needs",
      description:
        "Pick one service or bundle them together — our team keeps your dog's whole schedule in one place.",
    },
    services: [
      {
        href: "/dog-daycare",
        title: "Daycare",
        description: "Supervised play, socialization, and exercise for adult dogs and pups.",
        image:
          "https://images.unsplash.com/photo-1620021030259-977a6aa9006f?auto=format&fit=crop&w=800&q=80",
        imageAlt: "Dogs socializing together at daycare",
      },
      {
        href: "/boarding",
        title: "Boarding",
        description: "Cage-free overnight stays with a pet-loving team on-site around the clock.",
        image:
          "https://images.unsplash.com/photo-1529472119196-cb724127a98e?auto=format&fit=crop&w=800&q=80",
        imageAlt: "Dog relaxing comfortably during overnight boarding",
      },
      {
        href: "/bath",
        title: "Bath",
        description: "A calming bath, brushing, nail trim, and ear cleaning during daycare hours.",
        image:
          "https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=800&q=80",
        imageAlt: "Dog getting a bath",
      },
      {
        href: "/dog-walking",
        title: "Dog Walking",
        description: "Solo or pack walks around the neighborhood, on their schedule or yours.",
        image:
          "https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48?auto=format&fit=crop&w=800&q=80",
        imageAlt: "Dog on a walk with a handler",
      },
    ],
    why: {
      eyebrow: "Why pack parents choose us",
      title: "Care that treats your dog like part of the pack",
      description: "",
    },
    valueProps: [
      {
        title: "Trained eyes on every playgroup",
        body: "Our staff actively supervises play sessions and groups dogs by size, temperament, and energy level — not just first-come, first-served.",
      },
      {
        title: "Veterinary knowledge on-site",
        body: "With a background in veterinary medicine on our team, we know what healthy, happy play looks like — and when a dog needs a breather.",
      },
      {
        title: "Cage-free, always",
        body: "Boarding dogs relax in comfortable shared spaces, not crates, with a team member on-site overnight.",
      },
      {
        title: "Everything in one place",
        body: "Daycare, boarding, baths, and walks — so your dog's whole routine is handled by people who already know them.",
      },
    ],
    teamTeaser: {
      eyebrow: "Meet the team",
      title: "Run by people who actually love dogs",
      description:
        "A team built around one idea: dogs do best with movement, structure, and a pack.",
    },
    teamLinkLabel: "Get to know the team →",
    reviewsHeading: {
      eyebrow: "Reviews",
      title: "What pack parents are saying",
      description: "",
    },
  },

  daycare: {
    seo: {
      title: "Dog Daycare",
      description:
        "Supervised dog daycare. Half-day and full-day options, trained staff, and small, temperament-matched playgroups.",
    },
    hero: {
      eyebrow: "Daycare",
      title: "A day full of play, not a day in a crate.",
      description:
        "Dogs are pack animals — they need to move, sniff, run, and socialize. Our daycare gives adult dogs and pups a supervised, temperament-matched playgroup every weekday.",
      image:
        "https://images.unsplash.com/photo-1620021030259-977a6aa9006f?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Dogs playing together in a supervised daycare playgroup",
    },
    how: {
      eyebrow: "How it works",
      title: "Half day or full day — you decide",
      description:
        "Drop off in the morning and pick up whenever fits your schedule. Every dog is grouped with playmates that match their size and energy, and a staff member is always supervising.",
    },
    options: [
      {
        title: "Half Day",
        body: "Under 4 hours — perfect for a morning appointment or a short errand run.",
      },
      {
        title: "Full Day",
        body: "A full day of play, rest, and socialization, Monday – Friday, 7 AM – 7 PM.",
      },
    ],
    note: "Ask about our 10-day daycare package for frequent visitors. Late pickup fees apply after closing.",
    requirements: {
      eyebrow: "Before their first visit",
      title: "What your dog needs to join the pack",
      description: "",
    },
    requirementItems: [
      "Current vaccinations: Distemper, Bordetella, Rabies, Canine Influenza, and Leptospirosis",
      "Spayed or neutered by 6 months of age",
      "Flea and tick free",
      "Collar and leash required at drop-off",
      "A quick temperament test before your dog's first visit",
    ],
    extra: {
      eyebrow: "While they're here",
      title: "Add a bath to any daycare day",
      description:
        "Our in-house specialist can give your dog a calming bath, brush-out, nail trim, and ear cleaning during their regular daycare visit — no separate trip needed.",
    },
    extraLinkLabel: "See bath & grooming details →",
    extraLinkHref: "/bath",
    cta: {
      title: "Book your dog's first day",
      description:
        "New here? We'll start with a quick meet & greet and temperament check.",
    },
  },

  boarding: {
    seo: {
      title: "Cage-Free Dog Boarding",
      description:
        "Overnight dog boarding — cage-free accommodations with a pet-loving team on-site around the clock, plus daytime play included.",
    },
    hero: {
      eyebrow: "Boarding",
      title: "Cage-free boarding with a pet-loving team on-site overnight.",
      description:
        "A home away from home for your dog while you're away — safe, comfortable, and never in a crate, with daytime play built right in.",
      image:
        "https://images.unsplash.com/photo-1529472119196-cb724127a98e?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Dog resting comfortably during overnight boarding",
    },
    included: {
      eyebrow: "What's included",
      title: "More than a place to sleep",
      description:
        "Boarding here means your dog spends the day playing with their pack, then settles in for a calm, supervised night.",
    },
    amenities: [
      {
        title: "Safe, cozy accommodations",
        body: "A clean, secure, comfortable space to rest — never a crate.",
      },
      {
        title: "Overnight supervision",
        body: "A pet-loving team member is on-site around the clock, every night.",
      },
      {
        title: "Daytime play included",
        body: "Boarding guests join daycare playgroups during the day at no extra cost.",
      },
      {
        title: "Customized care",
        body: "Dietary needs and medication schedules are handled exactly how you specify.",
      },
    ],
    goodToKnow: {
      eyebrow: "Good to know",
      title: "Before your dog's first stay",
      description: "",
    },
    goodToKnowItems: [
      "A quick meet & greet, plus current vaccinations",
      "Two prior daycare visits are recommended so we know your dog before their first overnight stay",
      "Optional transport service available for $25 one-way within 5 miles",
      "Add a daily walk, medication support, or a second dog from the same address at a discount",
    ],
    note: "See exact nightly rates and add-on pricing on our prices page.",
    cta: {
      title: "Traveling soon? Let's set up a meet & greet.",
      description:
        "Reservations are limited to keep our overnight guest list small and well-supervised — reach out early.",
    },
  },

  bath: {
    seo: {
      title: "Dog Bathing & Grooming",
      description:
        "Calming dog baths, brushing, nail trims, and ear cleaning — added seamlessly to your dog's daycare visit.",
    },
    hero: {
      eyebrow: "Bath & Grooming",
      title: "Give your dog a refreshing bath during daycare time.",
      description:
        "No separate trip, no extra stress. Our in-house specialist works bath time into your dog's regular daycare visit, with a calm, patient approach for dogs who aren't sure about water.",
      image:
        "https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Dog getting a calm, gentle bath",
    },
    included: {
      eyebrow: "What's included",
      title: "A full refresh, not just a rinse",
      description: "",
    },
    items: [
      { title: "Bath", body: "A calming, thorough bath sized to your dog." },
      {
        title: "Brush & Nail Trim",
        body: "A full brush-out plus a nail trim, available for any size dog.",
      },
      { title: "Ear Cleaning", body: "A gentle ear cleaning to round out the visit." },
    ],
    note: "Pricing is based on your dog's size.",
    cta: {
      title: "Add a bath to your dog's next visit",
      description:
        "Just let us know when you drop off, and we'll work it into their daycare day.",
    },
  },

  walking: {
    seo: {
      title: "Dog Walking",
      description:
        "Solo dog walks around the neighborhood, available as single walks or a 10-day package with no expiration.",
    },
    hero: {
      eyebrow: "Dog Walking",
      title: "A midday walk when you can't get away.",
      description:
        "A 30-minute neighborhood walk to stretch legs, sniff the block, and break up a long day home alone — booked as a one-off or a standing package.",
      image:
        "https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Dog on a walk with a handler in the neighborhood",
    },
    how: {
      eyebrow: "How it works",
      title: "Flexible, no-expiration packages",
      description: "",
    },
    options: [
      {
        title: "Single Walk",
        body: "A 30-minute walk around the neighborhood, booked whenever you need it.",
      },
      {
        title: "10-Day Package",
        body: "Prepay for 10 walks and use them whenever — the package never expires.",
      },
    ],
    note: "See exact rates on the prices page.",
    cta: {
      title: "Set up a standing walk schedule",
      description: "Tell us your dog's routine and we'll build a walking schedule around it.",
    },
  },

  prices: {
    seo: {
      title: "Prices",
      description:
        "See pricing for dog daycare, cage-free boarding, bathing, and dog walking.",
    },
    heading: {
      eyebrow: "Prices",
      title: "Simple, transparent pricing",
      description: "No surprise fees — just what's below, plus any add-ons you choose.",
    },
  },

  gallery: {
    seo: {
      title: "Gallery",
      description: "A look inside daycare and boarding.",
    },
    heading: {
      eyebrow: "Gallery",
      title: "A peek inside the pack",
      description: "A look at daycare, boarding, bath day and everything in between.",
    },
  },

  about: {
    seo: {
      title: "About Us",
      description:
        "Meet the team and learn our approach to daycare, boarding, and dog care.",
    },
    eyebrow: "About Us",
    title: "Dogs are pack animals. We built a place for them to act like it.",
    intro:
      "We exist because dogs need more than a backyard — they need to move, sniff, run, and socialize. We give pet owners peace of mind while their dogs get real, supervised playtime with a pack that fits them.",
    teamHeading: {
      eyebrow: "Our team",
      title: "The people behind the pack",
      description: "",
    },
    // Empty on purpose, and the about page skips the whole section when it is.
    //
    // This used to name three real people and point at three photographs of
    // their faces, bundled into the repository. Every deployment of this app
    // shipped them, so a daycare on the other side of the country introduced
    // its customers to staff who have never worked there.
    //
    // Added under Settings → Website → Team, where the photos go to storage
    // rather than into the source tree.
    team: [],
    approach: {
      eyebrow: "Our approach",
      title: "Small, well-matched playgroups — always supervised",
      description:
        "Every dog is grouped by size, energy, and temperament, and a trained staff member actively watches every session. It's the same reason we require a quick temperament check before any dog's first visit — it keeps every day safe and genuinely fun.",
    },
  },

  contact: {
    seo: {
      title: "Contact Us",
      description:
        "Get in touch — call, text, email, or send a message to book a meet & greet.",
    },
    heading: {
      eyebrow: "Contact",
      title: "Let's find your dog's new favorite spot",
      description:
        "Reach out with any questions, or send a message to start enrollment — we typically reply the same day.",
    },
  },
};
