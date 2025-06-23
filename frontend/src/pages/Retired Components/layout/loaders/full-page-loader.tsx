import { Loader } from '@/components/common/loader'
import { Flex, Text } from '@radix-ui/themes'
'@radix-ui/themes/dist/cjs/components/flex'
import { clsx } from 'clsx'


export const FullPageLoader = ({ text = "Ravens are finding their way to you...", ...props }) => {
    return (
        <Flex align='center' width='100%' justify='center' {...props} className={clsx('h-screen', props.className)}>
            <Flex justify='center' align='center' direction='row' gap='4'>
                <Loader />
                <Text as='span' color='gray' className='cal-sans'>{text}</Text>
            </Flex>
        </Flex>
    )
}