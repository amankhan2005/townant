import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '../../components/ui.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="mx-auto max-w-xl gutter py-16">
      <EmptyState icon={Compass} title="We couldn't find that page" body="The link may be out of date." action={<Link to="/" className="font-semibold text-teal">Go home</Link>} />
    </div>
  );
}
