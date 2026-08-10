'use client'

import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { WheelDemo } from './wheel-demo'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-(--space-3)">
      <span className="text-muted-foreground w-28 shrink-0 text-xs">
        {label}
      </span>
      {children}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-(--space-4)">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function KitchenSink() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-(--space-8) p-(--space-8)">
      <div>
        <h1>Kitchen sink</h1>
        <p className="text-muted-foreground">
          Every installed primitive, retuned to the Organic tokens. Tab through
          the page to check the focus ring lands on each control.
        </p>
      </div>

      <Section title="Button">
        <Row label="variants">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row label="sizes">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Icon button">
            ★
          </Button>
          <Button size="icon-sm" aria-label="Small icon button">
            ★
          </Button>
        </Row>
        <Row label="disabled">
          <Button disabled>Primary</Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
        </Row>
        <Row label="block">
          <div className="flex-1">
            <Button block>Full width</Button>
          </div>
        </Row>
      </Section>

      <Section title="Input">
        <Row label="default">
          <div className="flex-1">
            <Input placeholder="Add an option…" />
          </div>
        </Row>
        <Row label="filled">
          <div className="flex-1">
            <Input defaultValue="Tacos el Bronco" />
          </div>
        </Row>
        <Row label="disabled">
          <div className="flex-1">
            <Input placeholder="Disabled" disabled />
          </div>
        </Row>
        <Row label="invalid">
          <div className="flex-1">
            <Input defaultValue="Too long…" aria-invalid />
          </div>
        </Row>
        <Row label="with button">
          <div className="flex flex-1 gap-(--space-2)">
            <Input placeholder="Add an option…" />
            <Button variant="secondary">Add</Button>
          </div>
        </Row>
      </Section>

      <Section title="Badge">
        <Row label="variants">
          <Badge>Accent</Badge>
          <Badge variant="secondary">Second voice</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </Row>
        <Row label="in context">
          <span className="text-sm">Tacos el Bronco</span>
          <Badge variant="neutral">Picked</Badge>
        </Row>
      </Section>

      <Section title="Dialog">
        <Row label="modal">
          <Dialog>
            <DialogTrigger render={<Button variant="secondary" />}>
              Open dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this wheel?</DialogTitle>
                <DialogDescription>
                  Everyone holding the share link loses access. This cannot be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <Input placeholder="Focus trap probe" />
              <DialogFooter>
                <DialogClose render={<Button variant="secondary" />}>
                  Cancel
                </DialogClose>
                <DialogClose render={<Button variant="destructive" />}>
                  Delete
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Row>
      </Section>

      <Section title="Toast">
        <Row label="sonner">
          <Button onClick={() => toast('Link copied')}>Fire a toast</Button>
          <Button
            variant="secondary"
            onClick={() => toast.success('Option added')}
          >
            Success
          </Button>
        </Row>
      </Section>

      <Section title="Type and links">
        <Row label="heading">
          <h3>Caprasimo at h3</h3>
        </Row>
        <Row label="link">
          <a href="#top">An inline link at accent-700</a>
        </Row>
      </Section>

      {/*
        Not a shadcn primitive, and the only thing on this page that is not.
        It is here because a 4.3-second easing curve is the one part of TASK-16
        that no assertion can check — the tests prove the wheel lands on the
        right wedge, not that getting there looks like a spin.
      */}
      <Section title="Wheel">
        <WheelDemo />
      </Section>

      <Toaster />
    </main>
  )
}
