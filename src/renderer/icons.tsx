/**
 * Fluent System Icons (Windows 11), under the names the screens already use. Each icon takes a
 * pixel `size` like before; stroke width does not apply to Fluent glyphs and is ignored.
 */
import type { ComponentType, CSSProperties } from 'react';
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowDownLeftRegular,
  ArrowDownloadRegular,
  ArrowMinimizeVerticalRegular,
  ArrowUploadRegular,
  ArrowUpRightRegular,
  BookOpenRegular,
  BoxRegular,
  BuildingBankRegular,
  BuildingRegular,
  CalculatorRegular,
  CalendarLtrRegular,
  CheckmarkCircleRegular,
  CheckmarkRegular,
  ChevronDownRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ChevronUpRegular,
  ClockRegular,
  CopyRegular,
  DataBarVerticalRegular,
  DeleteRegular,
  DismissRegular,
  DismissSquareRegular,
  DocumentAddRegular,
  DocumentCheckmarkRegular,
  DocumentTableRegular,
  EditRegular,
  ErrorCircleRegular,
  FolderOpenRegular,
  GridRegular,
  HistoryRegular,
  HomeRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  PersonRegular,
  ProhibitedRegular,
  ReceiptRegular,
  ScalesRegular,
  SearchRegular,
  SettingsRegular,
  ShieldCheckmarkRegular,
  SquareMultipleRegular,
  SquareRegular,
  SubtractRegular,
  TextBulletListTreeRegular,
  WalletRegular,
  WindowMultipleRegular,
} from '@fluentui/react-icons';

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
}
export type LucideIcon = ComponentType<IconProps>;

type Fluent = ComponentType<{
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
}>;
function icon(Glyph: Fluent): LucideIcon {
  const Icon = ({ size = 16, strokeWidth: _ignored, style, className, ...aria }: IconProps) => (
    <Glyph
      {...aria}
      className={`icon${className ? ` ${className}` : ''}`}
      style={{ fontSize: size, flex: 'none', ...style }}
      {...(aria['aria-label'] ? {} : { 'aria-hidden': true })}
    />
  );
  return Icon;
}

export const ArrowDownLeft = icon(ArrowDownLeftRegular);
export const ArrowUpRight = icon(ArrowUpRightRegular);
export const Ban = icon(ProhibitedRegular);
export const BookOpen = icon(BookOpenRegular);
export const Building2 = icon(BuildingRegular);
export const CalendarDays = icon(CalendarLtrRegular);
export const Calculator = icon(CalculatorRegular);
export const Check = icon(CheckmarkRegular);
export const CheckCheck = icon(DocumentCheckmarkRegular);
export const CheckCircle2 = icon(CheckmarkCircleRegular);
export const ChevronDown = icon(ChevronDownRegular);
export const ChevronLeft = icon(ChevronLeftRegular);
export const ChevronRight = icon(ChevronRightRegular);
export const ChevronUp = icon(ChevronUpRegular);
export const CircleAlert = icon(ErrorCircleRegular);
export const Clock3 = icon(ClockRegular);
export const Copy = icon(CopyRegular);
export const FileDown = icon(ArrowDownloadRegular);
export const FilePlus2 = icon(DocumentAddRegular);
export const FileSpreadsheet = icon(DocumentTableRegular);
export const FoldVertical = icon(ArrowMinimizeVerticalRegular);
export const History = icon(HistoryRegular);
export const Home = icon(HomeRegular);
export const Inbox = icon(FolderOpenRegular);
export const Landmark = icon(BuildingBankRegular);
export const Layers = icon(WindowMultipleRegular);
export const LayoutDashboard = icon(HomeRegular);
export const LayoutGrid = icon(GridRegular);
export const ListTree = icon(TextBulletListTreeRegular);
export const Lock = icon(LockClosedRegular);
export const Minus = icon(SubtractRegular);
export const Navigation = icon(NavigationRegular);
export const Package = icon(BoxRegular);
export const Pencil = icon(EditRegular);
export const Plus = icon(AddRegular);
export const ReceiptText = icon(ReceiptRegular);
export const RefreshCw = icon(ArrowClockwiseRegular);
export const Reports = icon(DataBarVerticalRegular);
export const Restore = icon(SquareMultipleRegular);
export const Scale = icon(ScalesRegular);
export const ScrollText = icon(CalculatorRegular);
export const Search = icon(SearchRegular);
export const Settings = icon(SettingsRegular);
export const ShieldCheck = icon(ShieldCheckmarkRegular);
export const Square = icon(SquareRegular);
export const SquareX = icon(DismissSquareRegular);
export const Trash2 = icon(DeleteRegular);
export const Upload = icon(ArrowUploadRegular);
export const UserRound = icon(PersonRegular);
export const Users = icon(PeopleRegular);
export const Wallet = icon(WalletRegular);
export const X = icon(DismissRegular);
