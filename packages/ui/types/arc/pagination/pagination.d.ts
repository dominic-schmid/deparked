export interface PaginationProps {
    page: number;
    pageCount: number;
    onPageChange: (page: number) => void;
    label?: string;
}
export declare function Pagination({ page, pageCount, onPageChange, label }: PaginationProps): import("react").JSX.Element;
