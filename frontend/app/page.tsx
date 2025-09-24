import { Notebook } from '@/components/Notebook';

export default function Home() {
  return (
    <div className="notebook-wrapper">
      <div id="notebook" className="notebook">
        <Notebook notebookName="default" />
      </div>
    </div>
  );
}
