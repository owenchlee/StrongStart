// Resource Access and Knowledge Centre (Requirements §5)
import { Router } from 'express';
import { resolve } from 'node:path';

export const resourcesRouter = Router();
const PUBLIC_DIR = resolve('public');

// Public / Facilitator: Serve resources page
resourcesRouter.get('/resources', (_req, res) => res.sendFile('resources.html', { root: PUBLIC_DIR }));

// Knowledge Centre catalog. `available: false` = listed but not published yet (shown as "Coming soon").
export const KNOWLEDGE_CENTRE = {
  categories: [
    {
      id: 'promotional',
      title: 'Promotional Resources',
      description: 'Flyers, social media graphics, and customizable posters to advertise Baby Connections in your community.',
      items: [
        {
          title: 'Baby Connections Promotional Poster (Printable 8.5x11)',
          format: 'PDF',
          size: '1.4 MB',
          url: '/resources/Baby-Connections-Poster-2026.pdf',
          available: false,
          description: 'Customizable poster with blank space for your program dates and location.'
        },
        {
          title: 'Social Media Announcement Kit',
          format: 'ZIP / PNG',
          size: '4.8 MB',
          url: '/resources/Baby-Connections-Social-Kit.zip',
          available: false,
          description: 'High-res square and story images for Instagram, Facebook, and LinkedIn.'
        },
        {
          title: 'Parent Invitation Email Template',
          format: 'DOCX',
          size: '42 KB',
          url: '/resources/Parent-Invitation-Email-Template.docx',
          available: false,
          description: 'Pre-written email to invite registered families before session one.'
        }
      ]
    },
    {
      id: 'templates',
      title: 'Templates & Delivery Guides',
      description: 'Facilitator guides, weekly lesson outlines, book sharing tip sheets, and songs.',
      items: [
        {
          title: 'Facilitator Curriculum & Session Guide (Weeks 1-6)',
          format: 'PDF',
          size: '3.2 MB',
          url: '/resources/Facilitator-Curriculum-Guide.pdf',
          available: false,
          description: 'Complete step-by-step facilitator manual with timing, sensory activities, and book prompts.'
        },
        {
          title: 'Book Sharing Tip Sheet (English, French, Arabic, Spanish)',
          format: 'PDF',
          size: '850 KB',
          url: '/resources/Book-Sharing-Tips-Multilingual.pdf',
          available: false,
          description: 'Handout for parents demonstrating responsive face-to-face reading techniques.'
        },
        {
          title: 'Rhyme & Song Cards Printable Handout',
          format: 'PDF',
          size: '620 KB',
          url: '/resources/Baby-Connections-Songs-and-Rhymes.pdf',
          available: false,
          description: 'Pocket-sized song cards to give parents for tummy time and bedtime routines.'
        }
      ]
    },
    {
      id: 'evaluation',
      title: 'Evaluation Tools',
      description: 'Printable QR feedback sheets, facilitator guidance for collecting parent input.',
      items: [
        {
          title: 'Facilitator Evaluation & Survey Best Practices',
          format: 'PDF',
          size: '410 KB',
          url: '/resources/Evaluation-Best-Practices.pdf',
          available: false,
          description: 'Tips for ensuring high response rates and collecting verbal or written parent feedback.'
        },
        {
          title: 'Standard Paper Feedback Survey (Blank Master)',
          format: 'PDF',
          size: '320 KB',
          url: '/resources/Baby-Connections-Paper-Survey-Master.pdf',
          available: false,
          description: 'Printable survey form ready to photograph with your phone for AI handwriting transcription.'
        }
      ]
    },
    {
      id: 'videos',
      title: 'Supplemental Training Videos',
      description: 'Video demonstrations of key facilitation techniques and infant developmental milestones.',
      items: [
        {
          title: 'Demonstration: Engaging Reluctant or Shy Babies & Parents',
          format: 'Video (MP4)',
          duration: '8 mins',
          url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
          available: false,
          description: 'Experienced facilitators model circle time transitions and individual parent coaching.'
        },
        {
          title: 'Early Literacy Milestones in the First Year',
          format: 'Video (MP4)',
          duration: '12 mins',
          url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
          available: false,
          description: 'Deep dive into language acquisition, pointing, babbling, and book handling from 0 to 12 months.'
        }
      ]
    },
    {
      id: 'faq',
      title: 'Frequently Asked Questions & Program Updates',
      description: 'Answers to common facilitator questions about kit delivery, replacements, and multilingual support.',
      items: [
        {
          title: 'How do I request replacement materials or extra kits?',
          answer: 'You can request replacement materials at any time by sending an email or submitting an order through the orders portal.'
        },
        {
          title: 'What if a parent speaks a language not included in the standard kit?',
          answer: 'Baby Connections digital surveys feature audio read-aloud and translation. AI also automatically translates written parent feedback in over 20 languages back into English for program evaluation.'
        },
        {
          title: 'When should I submit my Program Completion Report?',
          answer: 'Please submit your completion report within 7 days of your final session at /complete/:token.'
        }
      ]
    }
  ]
};

resourcesRouter.get('/api/resources', (_req, res) => {
  res.json(KNOWLEDGE_CENTRE);
});
