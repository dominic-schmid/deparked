import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionButton } from "./components/arc/action-button/action-button";
import { Alert } from "./components/arc/alert/alert";
import { AnimatedCounter } from "./components/arc/animated-counter/animated-counter";
import { AnnouncementBar } from "./components/arc/announcement-bar/announcement-bar";
import { Avatar } from "./components/arc/avatar/avatar";
import { BarChart } from "./components/arc/bar-chart/bar-chart";
import { BottomSheet } from "./components/arc/bottom-sheet/bottom-sheet";
import { Breadcrumb } from "./components/arc/breadcrumb/breadcrumb";
import { ButtonGroup } from "./components/arc/button-group/button-group";
import { Card } from "./components/arc/card/card";
import { ChipGroup } from "./components/arc/chip-group/chip-group";
import { CodeBlock } from "./components/arc/code-block/code-block";
import { ColorPicker } from "./components/arc/color-picker/color-picker";
import { Combobox } from "./components/arc/combobox/combobox";
import { CommandPalette } from "./components/arc/command-palette/command-palette";
import { ConfirmMorph } from "./components/arc/confirm-morph/confirm-morph";
import { ContextMenu } from "./components/arc/context-menu/context-menu";
import { CopyButton } from "./components/arc/copy-button/copy-button";
import { Countdown } from "./components/arc/countdown/countdown";
import { Dialog, DialogContent, DialogTrigger } from "./components/arc/dialog/dialog";
import { Drawer, DrawerContent, DrawerTrigger } from "./components/arc/drawer/drawer";
import { DropdownMenu } from "./components/arc/dropdown-menu/dropdown-menu";
import { EmptyState } from "./components/arc/empty-state/empty-state";
import { ExpandableCard } from "./components/arc/expandable-card/expandable-card";
import { ExpandableText } from "./components/arc/expandable-text/expandable-text";
import { ExpandingSearch } from "./components/arc/expanding-search/expanding-search";
import { FilterToolbar } from "./components/arc/filter-toolbar/filter-toolbar";
import { HoldToConfirm } from "./components/arc/hold-to-confirm/hold-to-confirm";
import { HoverCard, HoverCardProfile } from "./components/arc/hover-card/hover-card";
import { InlineEdit } from "./components/arc/inline-edit/inline-edit";
import { LineChart } from "./components/arc/line-chart/line-chart";
import { MentionInput } from "./components/arc/mention-input/mention-input";
import { MetricCard } from "./components/arc/metric-card/metric-card";
import { MoneyInput } from "./components/arc/money-input/money-input";
import { NumberField } from "./components/arc/number-field/number-field";
import { OnboardingChecklist } from "./components/arc/onboarding-checklist/onboarding-checklist";
import { Pagination } from "./components/arc/pagination/pagination";
import { PasswordField } from "./components/arc/password-field/password-field";
import { PasswordStrength } from "./components/arc/password-strength/password-strength";
import { RadioCards } from "./components/arc/radio-cards/radio-cards";
import { RadioGroup } from "./components/arc/radio-group/radio-group";
import { ResizablePanel, ResizablePanels } from "./components/arc/resizable-panels/resizable-panels";
import { ScrollArea } from "./components/arc/scroll-area/scroll-area";
import { SearchField } from "./components/arc/search-field/search-field";
import SegmentedControl from "./components/arc/segmented-control/segmented-control";
import { Select } from "./components/arc/select/select";
import { Skeleton } from "./components/arc/skeleton/skeleton";
import { SortableDataTable } from "./components/arc/sortable-data-table/sortable-data-table";
import { Sparkline } from "./components/arc/sparkline/sparkline";
import { SplitButton } from "./components/arc/split-button/split-button";
import { Stepper } from "./components/arc/stepper/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/arc/tabs/tabs";
import { TagInput } from "./components/arc/tag-input/tag-input";
import { TextMorph } from "./components/arc/text-morph/text-morph";
import { ThemeSwitch } from "./components/arc/theme-switch/theme-switch";
import { Timeline } from "./components/arc/timeline/timeline";
import { ToastStack, ToastStackProvider } from "./components/arc/toast-stack/toast-stack";
import { ToggleGroup, ToggleGroupItem } from "./components/arc/toggle-group/toggle-group";
import { UsageMeter } from "./components/arc/usage-meter/usage-meter";
import { UserMenu } from "./components/arc/user-menu/user-menu";

const noop = () => {};

// Minimal props from each component's markdown doc at https://uiarc.dev/components/<name>/markdown.
const cases: Record<string, () => React.ReactElement> = {
  "action-button": () => <ActionButton label="Publish" onAction={noop} />,
  alert: () => (
    <Alert tone="warning" title="Card expires soon">
      Update your payment method.
    </Alert>
  ),
  "animated-counter": () => <AnimatedCounter label="Raised" value={1200} prefix="$" />,
  "announcement-bar": () => (
    <AnnouncementBar
      id="notice"
      messages={[{ id: "a", message: "Update available", action: { label: "Read", href: "/x" } }]}
    />
  ),
  avatar: () => <Avatar name="Maya Chen" status="online" />,
  "bar-chart": () => (
    <BarChart
      label="Visits"
      period="Sep 14-16"
      data={[
        { key: "a", label: "Mon", axisLabel: "M", value: 32 },
        { key: "b", label: "Tue", axisLabel: "T", value: 48 },
      ]}
    />
  ),
  "bottom-sheet": () => (
    <BottomSheet trigger={<button type="button">Open</button>} title="Details">
      <p>Body</p>
    </BottomSheet>
  ),
  breadcrumb: () => <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Domains" }]} />,
  "button-group": () => <ButtonGroup label="Actions" items={[{ id: "a", label: "Share", onSelect: noop }]} />,
  card: () => <Card title="example.com" description="Live" />,
  "chip-group": () => (
    <ChipGroup label="Topics" value={[]} onValueChange={noop} options={[{ value: "a", label: "A" }]} />
  ),
  "code-block": () => <CodeBlock code="const a = 1;" filename="a.ts" language="ts" />,
  "color-picker": () => <ColorPicker label="Accent" value="#2F6BFF" onValueChange={noop} />,
  combobox: () => <Combobox label="Zone" options={[{ value: "a", label: "A" }]} value="" onValueChange={noop} />,
  "command-palette": () => (
    <CommandPalette items={[{ id: "a", label: "New project" }]} onSelect={noop} onClose={noop} />
  ),
  "confirm-morph": () => (
    <ConfirmMorph label="Delete" icon={<span />} prompt="Delete it?" confirmMode="hold" onConfirm={noop} />
  ),
  "context-menu": () => (
    <ContextMenu label="Actions" items={[{ id: "a", label: "Copy", onSelect: noop }]}>
      <div>Tile</div>
    </ContextMenu>
  ),
  "copy-button": () => <CopyButton value="hello" label="Copy" />,
  countdown: () => <Countdown target="2030-01-01T00:00:00Z" label="Starts in" />,
  dialog: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">Open</button>
      </DialogTrigger>
      <DialogContent title="Rename">Body</DialogContent>
    </Dialog>
  ),
  drawer: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <button type="button">Open</button>
      </DrawerTrigger>
      <DrawerContent title="Filters">Body</DrawerContent>
    </Drawer>
  ),
  "dropdown-menu": () => <DropdownMenu label="Actions" items={[{ label: "Rename", onSelect: noop }]} />,
  "empty-state": () => <EmptyState title="No matches" description="Clear the filters." />,
  "expandable-card": () => (
    <ExpandableCard title="Pro plan" description="Billed yearly">
      Details
    </ExpandableCard>
  ),
  "expandable-text": () => <ExpandableText lines={2}>Some longer text.</ExpandableText>,
  "expanding-search": () => (
    <ExpandingSearch label="Search" items={[{ id: "a", title: "Arc website" }]} onSelect={noop} />
  ),
  "filter-toolbar": () => <FilterToolbar filters={[]} onRemove={noop} onClearAll={noop} />,
  "hold-to-confirm": () => <HoldToConfirm label="Hold to delete" onConfirm={noop} />,
  "hover-card": () => (
    <HoverCard content={<HoverCardProfile name="Maya Chen" bio="Designer" />}>
      <button type="button">@maya</button>
    </HoverCard>
  ),
  "inline-edit": () => <InlineEdit label="Name" value="Harbour" onSave={noop} />,
  "line-chart": () => (
    <LineChart
      label="Signups"
      data={[
        { key: "a", label: "Sep 1", values: { s: 1 } },
        { key: "b", label: "Sep 2", values: { s: 2 } },
      ]}
      series={[{ key: "s", label: "Signups" }]}
    />
  ),
  "mention-input": () => (
    <MentionInput
      aria-label="Comment"
      people={[{ id: "u1", name: "Maya Chen" }]}
      value={{ text: "", mentions: [] }}
      onChange={noop}
    />
  ),
  "metric-card": () => <MetricCard label="Uptime" value={99.9} suffix="%" context="Last 30 days" />,
  "money-input": () => <MoneyInput label="Amount" value={1500} onValueChange={noop} currencies={["USD"]} />,
  "number-field": () => <NumberField label="Seats" value={5} onValueChange={noop} />,
  "onboarding-checklist": () => <OnboardingChecklist title="Set up" steps={[{ id: "a", title: "Invite your team" }]} />,
  pagination: () => <Pagination page={1} pageCount={5} onPageChange={noop} />,
  "password-field": () => <PasswordField label="Password" name="password" />,
  "password-strength": () => <PasswordStrength label="New password" name="password" />,
  "radio-cards": () => <RadioCards aria-label="Speed" name="speed" options={[{ value: "a", label: "Standard" }]} />,
  "radio-group": () => (
    <RadioGroup label="Plan" name="plan" value="a" onValueChange={noop} options={[{ value: "a", label: "Solo" }]} />
  ),
  "resizable-panels": () => (
    <ResizablePanels label="Layout">
      <ResizablePanel id="a" label="A" defaultSize={50}>
        A
      </ResizablePanel>
      <ResizablePanel id="b" label="B" defaultSize={50}>
        B
      </ResizablePanel>
    </ResizablePanels>
  ),
  "scroll-area": () => (
    <ScrollArea maxHeight={200} label="Activity">
      <p>Row</p>
    </ScrollArea>
  ),
  "search-field": () => <SearchField label="Search" value="" onValueChange={noop} />,
  "segmented-control": () => (
    <SegmentedControl
      label="Range"
      value="a"
      onValueChange={noop}
      options={[
        { value: "a", label: "7 days" },
        { value: "b", label: "30 days" },
      ]}
    />
  ),
  select: () => <Select label="Region" value="a" onValueChange={noop} options={[{ value: "a", label: "Europe" }]} />,
  skeleton: () => (
    <Skeleton lines={2} loading>
      <p>Loaded</p>
    </Skeleton>
  ),
  "sortable-data-table": () => (
    <SortableDataTable
      rows={[{ id: "p1", name: "Harbour" }]}
      rowKey="id"
      caption="Projects"
      columns={[{ key: "name", label: "Name" }]}
    />
  ),
  sparkline: () => <Sparkline label="Signups" data={[1, 3, 2, 5]} value="5" />,
  "split-button": () => (
    <SplitButton label="Reply" onClick={noop} actions={[{ label: "Not interested", onSelect: noop }]} />
  ),
  stepper: () => (
    <Stepper
      current={0}
      steps={[
        { id: "a", label: "Token" },
        { id: "b", label: "Domain" },
      ]}
    />
  ),
  tabs: () => (
    <Tabs defaultValue="a">
      <TabsList aria-label="Sections">
        <TabsTrigger value="a">One</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Body</TabsContent>
    </Tabs>
  ),
  "tag-input": () => <TagInput label="Topics" value={["a"]} onValueChange={noop} />,
  "text-morph": () => <TextMorph>Publish</TextMorph>,
  "theme-switch": () => <ThemeSwitch theme="light" onThemeChange={noop} />,
  timeline: () => (
    <Timeline
      label="History"
      now={Date.parse("2026-09-22T10:00:00Z")}
      events={[{ id: "e1", at: "2026-09-22T09:12:00Z", title: "Published" }]}
    />
  ),
  "toast-stack": () => (
    <ToastStackProvider>
      <ToastStack />
    </ToastStackProvider>
  ),
  "toggle-group": () => (
    <ToggleGroup label="View" value="grid" onValueChange={noop}>
      <ToggleGroupItem value="grid" label="Grid">
        G
      </ToggleGroupItem>
      <ToggleGroupItem value="list" label="List">
        L
      </ToggleGroupItem>
    </ToggleGroup>
  ),
  "usage-meter": () => (
    <UsageMeter label="Storage" unit="GB" limit={50} segments={[{ id: "a", label: "Files", value: 20 }]} />
  ),
  "user-menu": () => (
    <UserMenu
      user={{ name: "Maya Chen", email: "maya@example.com" }}
      items={[{ label: "Settings", onSelect: noop }]}
      onSignOut={noop}
    />
  ),
};

describe("vendored Arc components render on the server", () => {
  for (const [name, element] of Object.entries(cases)) {
    it(name, () => {
      expect(renderToStaticMarkup(element())).toBeTypeOf("string");
    });
  }
});
