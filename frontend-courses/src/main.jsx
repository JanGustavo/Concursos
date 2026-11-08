import React from 'react';
import {createRoot} from 'react-dom/client';
import {CourseLibrary} from './CourseLibrary.jsx';
import './styles.css';
const container=document.getElementById('courses-root');
if(container)createRoot(container).render(<CourseLibrary/>);

import {GettingStarted,StudyPlanner} from './StudyPlanner.jsx';
import './planner.css';
const start=document.getElementById('start-root');if(start)createRoot(start).render(<GettingStarted/>);
const planner=document.getElementById('planner-root');if(planner)createRoot(planner).render(<StudyPlanner/>);

import {StudyAssistant} from './StudyAssistant.jsx';
import './assistant.css';
const assistant=document.getElementById('assistant-root');if(assistant)createRoot(assistant).render(<StudyAssistant/>);

import './onboarding.css';

import './ai-plan.css';

import {AnkiLibrary} from './AnkiLibrary.jsx';
import './anki.css';
const anki=document.getElementById('anki-root');if(anki)createRoot(anki).render(<AnkiLibrary/>);

import {SupportPix} from './SupportPix.jsx';
const support=document.getElementById('support-root');if(support)createRoot(support).render(<SupportPix/>);

import {ExamAssistant} from './ExamAssistant.jsx';
const examAssistant=document.getElementById('exam-ai-root');if(examAssistant)createRoot(examAssistant).render(<ExamAssistant/>);

import './tutorial.js';
