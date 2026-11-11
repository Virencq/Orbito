import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en'],
  resources: {
    en: {
      translation: {
        mcp: {
          title: 'MCP Servers',
          description: 'Manage Model Context Protocol servers available to Orbito and JCode.',
          syncAll: 'Sync All',
          addServer: 'Add Server',
          emptyTitle: 'No MCP servers configured',
          emptyDesc: 'Add a server or sync to import servers from your JCode configuration.',
        },
        skills: {
          title: 'Skills',
          description: 'Manage the skills available to your agents.',
          activeCount: '{{count}} active skills',
          lastScan: 'Last scan: {{time}}',
          paths: 'Skill paths',
          scan: 'Scan skills',
          installFromZip: 'Install from ZIP',
          addSkill: 'Add skill',
          active: 'Active',
          inactive: 'Inactive',
          location: 'Skill location',
          instructionContent: 'Skill instructions',
          copy: 'Copy',
          remove: 'Remove skill',
          enable: 'Enable skill',
          disable: 'Disable skill',
          emptyTitle: 'No skills found',
          emptyDescription: 'Add a skills folder or scan again to discover installed skills.',
          scanning: 'Scanning…',
          scanFailed: 'Could not scan skills',
          confirmRemove: 'Remove this skill?',
          addPath: 'Add path',
          removePath: 'Remove path',
          close: 'Close',
          cancel: 'Cancel',
          save: 'Save',
          name: 'Name',
          descriptionLabel: 'Description',
          content: 'Instructions',
          namePlaceholder: 'my-skill',
          descriptionPlaceholder: 'What this skill helps with',
          contentPlaceholder: 'Write the skill instructions in Markdown…',
        },
        chat: {
          input: {
            placeholder: 'What would you like me to do?',
            placeholderWithFiles: 'Add a message or drop files here',
          },
          time: {
            justNow: 'just now',
            minutesAgo: '{{n}} min ago',
            hoursAgo: '{{n}} hr ago',
            daysAgo: '{{n}} days ago',
          },
          copy: {
            copy: 'Copy',
            copied: 'Copied',
          },
          actions: {
            edit: 'Edit',
            delete: 'Delete',
          },
          layout: {
            openFiles: 'Open files',
            backToSessions: 'Back to sessions',
          },
          session: {
            readOnly: 'Read only',
            readOnlyHint: 'This session is read-only.',
            readOnlyPlaceholder: 'This session is read-only',
          },
          errors: {
            sessionFailed: 'Could not start the JCode session.',
            dismiss: 'Dismiss',
          },
          toolApproval: {
            title: 'Tool approval required',
            subtitle: 'JCode wants to run a tool in this workspace.',
            dangerous: 'Approval',
            cancel: 'Cancel',
            reject: 'Reject',
            approve: 'Approve',
          },
        },
      },
    },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
