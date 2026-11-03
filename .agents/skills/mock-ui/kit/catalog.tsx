// Renders one of every components/ui primitive so the build can read each data-slot's real classes.
import { renderToStaticMarkup } from "react-dom/server";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Section } from "@/components/ui/section";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGrid, StatNote, StatTile, StatValue } from "@/components/ui/stat-tile";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const BUTTON_VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const BUTTON_SIZES = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const;

export function renderCatalog() {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <Button>b</Button> <Badge>b</Badge>
      <Input /> <Textarea /> <Checkbox checked /> <Switch checked /> <Label>l</Label>
      <Separator /> <Skeleton />
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="#">a</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>b</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <Avatar><AvatarFallback>MG</AvatarFallback></Avatar>
      <Card><CardHeader><CardTitle>t</CardTitle><CardDescription>d</CardDescription><CardAction>a</CardAction></CardHeader><CardContent>c</CardContent><CardFooter>f</CardFooter></Card>
      <Tabs value="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent></Tabs>
      <Table><TableHeader><TableRow><TableHead>h</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>c</TableCell></TableRow></TableBody><TableFooter><TableRow><TableCell>f</TableCell></TableRow></TableFooter></Table>
      <Dialog open><DialogContent><DialogHeader><DialogTitle>t</DialogTitle><DialogDescription>d</DialogDescription></DialogHeader><DialogFooter>f</DialogFooter></DialogContent></Dialog>
      <Sheet open><SheetContent><SheetHeader><SheetTitle>t</SheetTitle><SheetDescription>d</SheetDescription></SheetHeader><SheetFooter>f</SheetFooter></SheetContent></Sheet>
      <DropdownMenu open><DropdownMenuTrigger>t</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>l</DropdownMenuLabel><DropdownMenuItem>i<DropdownMenuShortcut>⌘K</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuCheckboxItem checked>c</DropdownMenuCheckboxItem><DropdownMenuSeparator /></DropdownMenuContent></DropdownMenu>
      <Select open value="a"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">A</SelectItem></SelectContent></Select>
      <Popover open><PopoverTrigger>t</PopoverTrigger><PopoverContent>c</PopoverContent></Popover>
      <Tooltip open><TooltipTrigger>t</TooltipTrigger><TooltipContent>c</TooltipContent></Tooltip>
    </TooltipProvider>,
  );
  // Whole pieces rendered from the real components and reused as markup; the runtime fills the
  // __PLACEHOLDERS__.
  const templates = {
    // components/ui/stat-tile.tsx: a figure tile with one note.
    statTile: renderToStaticMarkup(
      <StatTile label="__LABEL__"><StatValue>__VALUE__</StatValue><StatNote>__NOTE__</StatNote></StatTile>,
    ),
    statGrid: renderToStaticMarkup(<StatGrid>__TILES__</StatGrid>),
    // components/ui/section.tsx: heading, description, actions on the same row, then the content.
    section: renderToStaticMarkup(
      <Section title="__TITLE__" description="__DESCRIPTION__" actions="__ACTIONS__">__BODY__</Section>,
    ),
  };
  const variants = {
    button: Object.fromEntries(BUTTON_VARIANTS.flatMap((v) => BUTTON_SIZES.map((s) => [`${v}/${s}`, buttonVariants({ variant: v, size: s })]))),
    badge: Object.fromEntries(BADGE_VARIANTS.map((v) => [v, badgeVariants({ variant: v })])),
  };
  return { html, variants, templates };
}
