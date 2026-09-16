// The editor's stylesheet loads with the route that uses it, not with every lesson a learner opens.
import '../editor.css';
import { AuthoringWorkspace } from '@/features/authoring/authoring-workspace';

export const dynamic = 'force-dynamic';
export default function AuthoringPage() {
  return <AuthoringWorkspace />;
}
