import { Add01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";

interface SectionHeaderProps {
  id: string;
  title: string;
  addLabel: string;
  onAdd?: () => void;
}

export function SectionHeader({ id, title, addLabel, onAdd }: SectionHeaderProps) {
  return (
    <div className="group/header flex h-8 items-center gap-0.5 pr-1 pl-2">
      <h2 id={id} className="flex-1 text-button font-medium text-fg-secondary">
        {title}
      </h2>
      <Button variant="ghost" size="icon-sm" aria-label={addLabel} onClick={onAdd}>
        <Icon icon={Add01Icon} />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`${title} options`}>
        <Icon icon={MoreHorizontalIcon} />
      </Button>
    </div>
  );
}
