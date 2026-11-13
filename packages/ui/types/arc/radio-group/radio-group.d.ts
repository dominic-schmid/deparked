export interface RadioGroupProps {
    label: string;
    options: {
        value: string;
        label: string;
        description?: string;
    }[];
    value: string;
    onValueChange: (value: string) => void;
    name?: string;
}
/** One highlight travels to the chosen row while the new dot springs in and the old one shrinks away, so a change reads as a single physical move. Arrow keys take the same path. Rows and text never resize. */
export declare function RadioGroup({ label, options, value, onValueChange, name }: RadioGroupProps): import("react").JSX.Element;
