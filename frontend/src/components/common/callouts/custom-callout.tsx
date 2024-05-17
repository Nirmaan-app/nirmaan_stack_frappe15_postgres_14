import { Callout } from "@radix-ui/themes";
import { PropsWithChildren } from "react";
import { IconProps, RootProps, TextProps } from "@radix-ui/themes/dist/esm/components/callout.js";

export type CalloutObject = {
    state: boolean,
    message: string,
}

export type CustomCalloutProps = {
    rootProps?: RootProps;
    iconProps?: IconProps;
    iconChildren?: React.ReactNode;
    textProps?: TextProps;
    textChildren?: React.ReactNode;
};

export const CustomCallout = ({
    rootProps,
    iconProps,
    textProps,
    textChildren,
    iconChildren,
}: PropsWithChildren<CustomCalloutProps>) => {
    return (
        <Callout.Root {...rootProps}>
            <Callout.Icon {...iconProps}>{iconChildren}</Callout.Icon>
            <Callout.Text {...textProps}>{textChildren}</Callout.Text>
        </Callout.Root>
    );
};
