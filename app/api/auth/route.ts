import { NextResponse } from 'next/server';
import { settings } from '@/lib/config/settings';

export async function POST(req: Request) {
    try {
        const { password } = await req.json();
        const correctPassword = settings.auth.sitePassword;

        if (password === correctPassword) {
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
        }
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
