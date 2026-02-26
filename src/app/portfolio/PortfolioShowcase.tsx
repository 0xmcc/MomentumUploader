"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Space_Grotesk, Syne, IBM_Plex_Mono } from "next/font/google";
import {
  Braces,
  Gauge,
  Mic2,
  Sparkles,
  Split,
  Workflow,
} from "lucide-react";
import styles from "./portfolio.module.css";

const headlineFont = Syne({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-portfolio-headline",
});

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-portfolio-body",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-portfolio-mono",
});

const featureCards = [
  {
    title: "Real-time capture pipeline",
    detail:
      "Audio input flows through a low-friction recorder and upload queue with optimistic UI updates and reconciliation.",
    icon: Workflow,
  },
  {
    title: "NVIDIA-powered transcription",
    detail:
      "Batch and live speech recognition routes use NVIDIA Parakeet integration for fast ASR with resilient error handling.",
    icon: Mic2,
  },
  {
    title: "Voiceover generation",
    detail:
      "Speech-to-speech output supports curated voice profiles and strict timeout/validation logic through ElevenLabs.",
    icon: Sparkles,
  },
  {
    title: "Production-first architecture",
    detail:
      "Typed API contracts, Supabase-backed storage, Clerk auth, and route-level tests keep the workflow stable.",
    icon: Braces,
  },
];

const stackItems = [
  "Next.js App Router",
  "TypeScript (strict mode)",
  "Supabase Postgres + Storage",
  "Clerk Authentication",
  "NVIDIA Parakeet ASR",
  "ElevenLabs Speech-to-Speech",
  "Framer Motion",
  "Jest + RTL",
];

const milestones = [
  {
    step: "01",
    title: "Problem framing",
    summary:
      "Built for students and builders who think faster than they type and want searchable notes instantly.",
  },
  {
    step: "02",
    title: "Pipeline design",
    summary:
      "Designed around upload + transcription durability with immediate visual feedback and retry affordances.",
  },
  {
    step: "03",
    title: "API-first implementation",
    summary:
      "Created composable REST routes for memo CRUD, share links, voiceover generation, and live ASR preview.",
  },
  {
    step: "04",
    title: "Portfolio polish",
    summary:
      "Focused on visual identity, narrative flow, and engineering storytelling suitable for internship demos.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55 } },
};

export default function PortfolioShowcase() {
  return (
    <main
      className={`${styles.page} ${headlineFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />
      <div className={styles.noise} />

      <motion.section
        className={styles.hero}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.p className={styles.kicker} variants={itemVariants}>
          Portfolio Case Study • Open Source AI Product
        </motion.p>

        <motion.h1 className={styles.heroTitle} variants={itemVariants}>
          Sonic Memos
          <span> Built Like a Real Product, Presented Like a Showpiece.</span>
        </motion.h1>

        <motion.p className={styles.heroSubtitle} variants={itemVariants}>
          A full-stack voice memo app that turns recordings into structured,
          searchable knowledge. Designed as a high-signal portfolio project for
          computer science students applying to software engineering roles.
        </motion.p>

        <motion.div className={styles.heroCtas} variants={itemVariants}>
          <Link href="/" className={styles.primaryCta}>
            Open Live Workspace
          </Link>
          <Link href="/docs" className={styles.secondaryCta}>
            Explore API Docs
          </Link>
        </motion.div>
      </motion.section>

      <section className={styles.snapshot}>
        <div className={styles.previewShell}>
          <div className={styles.previewTag}>
            <Gauge size={14} />
            Production-minded UX and backend architecture
          </div>
          <Image
            src="/assets/memos-link-preview.png"
            alt="Sonic Memos application preview"
            width={1024}
            height={576}
            className={styles.previewImage}
            priority
          />
        </div>

        <div className={styles.stackCard}>
          <h2>Tech Stack Highlights</h2>
          <ul>
            {stackItems.map((item) => (
              <li key={item}>
                <Split size={14} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.features}>
        {featureCards.map(({ title, detail, icon: Icon }) => (
          <motion.article
            key={title}
            className={styles.featureCard}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ duration: 0.45 }}
          >
            <div className={styles.featureIcon}>
              <Icon size={20} />
            </div>
            <h3>{title}</h3>
            <p>{detail}</p>
          </motion.article>
        ))}
      </section>

      <section className={styles.pipeline}>
        <h2>System Flow</h2>
        <p>
          Record audio, upload safely, transcribe quickly, then share or
          re-voice with minimal user friction.
        </p>

        <div className={styles.pipelineGrid}>
          <div>
            <span>1</span>
            <h3>Capture</h3>
            <p>Browser microphone capture with upload-progress UX.</p>
          </div>
          <div>
            <span>2</span>
            <h3>Persist</h3>
            <p>Supabase Storage + Postgres memo records scoped per user.</p>
          </div>
          <div>
            <span>3</span>
            <h3>Transcribe</h3>
            <p>NVIDIA Parakeet ASR route for live and full transcription.</p>
          </div>
          <div>
            <span>4</span>
            <h3>Enhance</h3>
            <p>Optional ElevenLabs speech-to-speech voiceover generation.</p>
          </div>
          <div>
            <span>5</span>
            <h3>Deliver</h3>
            <p>Search, playback, markdown export, and shareable memo links.</p>
          </div>
        </div>
      </section>

      <section className={styles.milestones}>
        <h2>Project Narrative</h2>
        <div className={styles.milestoneGrid}>
          {milestones.map((milestone) => (
            <article key={milestone.step}>
              <span>{milestone.step}</span>
              <h3>{milestone.title}</h3>
              <p>{milestone.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.footerCta}>
        <p>Want this to be your internship centerpiece?</p>
        <h2>
          Ship the app, demo the architecture, and narrate the technical
          decisions confidently.
        </h2>
        <Link href="/" className={styles.primaryCta}>
          Launch Sonic Memos
        </Link>
      </section>
    </main>
  );
}
